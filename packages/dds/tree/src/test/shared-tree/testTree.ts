/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { assert } from "@fluidframework/common-utils";
import { v4 as uuid } from "uuid";
import {
	AnchorSet,
	Commit,
	EditManager,
	mintRevisionTag,
	IEditableForest,
	IForestSubscription,
	initializeForest,
	InMemoryStoredSchemaRepository,
	ITreeCursorSynchronous,
	mapCursorField,
	moveToDetachedField,
	SchemaData,
	SchemaPolicy,
	SeqNumber,
	SessionId,
	RevisionTag,
	makeAnonChange,
} from "../../core";
import { cursorToJsonObject, jsonSchemaData, singleJsonCursor } from "../../domains";
import {
	buildForest,
	DefaultChangeFamily,
	defaultChangeFamily,
	DefaultChangeset,
	DefaultEditBuilder,
	defaultSchemaPolicy,
} from "../../feature-libraries";
import { brand, JsonCompatible } from "../../util";

export interface TestTreeEdit {
	sessionId: SessionId;
	sessionEditNumber: number;
	refNumber: SeqNumber;
	change: DefaultChangeset;
	revision: RevisionTag;
}

export interface TestTreeOptions {
	sessionId?: string;
	schemaPolicy?: SchemaPolicy;
	schemaData?: SchemaData;
}

/**
 * A `SharedTree`-like class for the purpose of testing rebasing and editing logic.
 * Specifically, this class is help to write tests that:
 * - Control the sequencing order of edits. (see `Sequencer`)
 * - Target more stable APIs than unit tests can.
 *
 * Before you write a test using this class, please consider if a unit test or an integration test using the
 * actual `SharedTree` would be appropriate instead.
 */
export class TestTree {
	public static fromForest(forest: IEditableForest, options: TestTreeOptions = {}): TestTree {
		return new TestTree(forest, options);
	}

	public static fromCursor(
		cursor: ITreeCursorSynchronous[] | ITreeCursorSynchronous,
		options: TestTreeOptions = {},
	): TestTree {
		const schemaPolicy = options.schemaPolicy ?? defaultSchemaPolicy;
		const schema = new InMemoryStoredSchemaRepository(schemaPolicy, options.schemaData);
		const forest = buildForest(schema);
		initializeForest(forest, Array.isArray(cursor) ? cursor : [cursor]);
		return TestTree.fromForest(forest, options);
	}

	public static fromJson(
		json: JsonCompatible[] | JsonCompatible,
		options: TestTreeOptions = {},
	): TestTree {
		const cursors = Array.isArray(json) ? json.map(singleJsonCursor) : singleJsonCursor(json);
		return TestTree.fromCursor(cursors, { schemaData: jsonSchemaData, ...options });
	}

	public readonly sessionId: string;
	public readonly forest: IEditableForest;
	public readonly editManager: EditManager<DefaultChangeset, DefaultChangeFamily>;
	public readonly schemaPolicy: SchemaPolicy;

	private refNumber: number = -1;
	private _localEditsApplied: number = 0;
	private _remoteEditsApplied: number = 0;

	public get localEditsApplied(): number {
		return this._localEditsApplied;
	}
	public get remoteEditsApplied(): number {
		return this._remoteEditsApplied;
	}

	private constructor(forest: IEditableForest, options: TestTreeOptions = {}) {
		this.schemaPolicy = options.schemaPolicy ?? defaultSchemaPolicy;
		this.sessionId = options.sessionId ?? uuid();
		this.forest = forest;
		this.editManager = new EditManager<DefaultChangeset, DefaultChangeFamily>(
			defaultChangeFamily,
			this.sessionId,
			forest.anchors,
		);
	}

	public jsonRoots(): JsonCompatible[] {
		const reader = this.forest.allocateCursor();
		moveToDetachedField(this.forest, reader);
		const copy = mapCursorField(reader, cursorToJsonObject);
		reader.free();
		return copy;
	}

	public jsonRoot(): JsonCompatible {
		return this.jsonRoots()[0];
	}

	public fork(sessionId?: string): TestTree {
		const forest = this.forest.clone(this.forest.schema, new AnchorSet());
		return TestTree.fromForest(forest, {
			sessionId,
			schemaPolicy: this.schemaPolicy,
		});
	}

	/**
	 * Runs the given `transaction`, applying the resulting edit to the document.
	 * @param transaction - the transaction to run. It may not be aborted.
	 * @returns A edit that can be sequenced by the `Sequencer`.
	 */
	public runTransaction(
		transaction: (forest: IForestSubscription, editor: DefaultEditBuilder) => void,
	): TestTreeEdit {
		const editor = defaultChangeFamily.buildEditor((edit) => {
			const delta = defaultChangeFamily.intoDelta(edit);
			this.forest.applyDelta(delta);
		}, this.forest.anchors);
		transaction(this.forest, editor);
		const changes = editor.getChanges();

		// Using anonymous changes makes it impossible to chronologically order them during composition.
		// Such an ordering is needed when composing/squashing inverse changes with other changes, which is currently
		// not expected to happen in transactions but that could change in the future.
		const anonChanges = changes.map((c) => makeAnonChange(c));

		const changeset = defaultChangeFamily.rebaser.compose(anonChanges);
		const revision = mintRevisionTag();
		// Forest and anchors already reflect the results of this change since they were updated during transaction.
		this.editManager.addLocalChange(revision, changeset);
		const resultingEdit: TestTreeEdit = {
			sessionId: this.sessionId,
			change: changeset,
			sessionEditNumber: this._localEditsApplied,
			refNumber: brand(this.refNumber),
			revision,
		};
		this._localEditsApplied += 1;
		return resultingEdit;
	}

	/**
	 * Updates the tree's internal state in accordance with the sequenced edits.
	 */
	public receive(edits: CommittedTestTreeEdit[] | CommittedTestTreeEdit): void {
		if (!Array.isArray(edits)) {
			this.receive([edits]);
			return;
		}
		for (const edit of edits) {
			const delta = this.editManager.addSequencedChange(edit, edit.seqNumber, edit.refNumber);
			this.forest.applyDelta(delta);
			this._remoteEditsApplied += 1;
			this.refNumber = edit.seqNumber;
		}
	}
}

export type CommittedTestTreeEdit = TestTreeEdit &
	Commit<DefaultChangeset> & { seqNumber: SeqNumber };

interface ClientData {
	localEditNumber: number;
	refNumber: number;
}

/**
 * A test helper that allows the author of the test to control the sequencing order of edits.
 */
export class Sequencer {
	private seqNumber: number = 0;
	private readonly clients = new Map<SessionId, ClientData>();

	public constructor() {}

	/**
	 * Sequences the given edit.
	 *
	 * Successive calls to `Sequencer.sequence` for a given `Sequencer` instance results in the given edits
	 * being sequenced in the order of the `Sequencer.sequence` calls.
	 */
	public sequence(edit: TestTreeEdit): CommittedTestTreeEdit;
	/**
	 * Sequences the given edits in the given order.
	 *
	 * Successive calls to `Sequencer.sequence` for a given `Sequencer` instance results in the given edits
	 * being sequenced in the order of the `Sequencer.sequence` calls.
	 */
	public sequence(edits: TestTreeEdit[]): CommittedTestTreeEdit[];
	public sequence(
		edits: TestTreeEdit | TestTreeEdit[],
	): CommittedTestTreeEdit | CommittedTestTreeEdit[] {
		if (Array.isArray(edits)) {
			return edits.map((e) => this.sequence(e));
		}
		const edit: TestTreeEdit = edits;
		if (!this.clients.has(edit.sessionId)) {
			this.clients.set(edit.sessionId, { localEditNumber: -1, refNumber: -1 });
		}
		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		const clientData = this.clients.get(edit.sessionId)!;
		assert(
			edit.sessionEditNumber === clientData.localEditNumber + 1,
			"The sequencer should ingest all edits from each client",
		);
		assert(edit.refNumber >= clientData.refNumber, "Client's ref number should never decrease");
		clientData.localEditNumber = edit.sessionEditNumber;
		clientData.refNumber = edit.refNumber;
		const commit: CommittedTestTreeEdit = {
			...edit,
			seqNumber: brand(this.seqNumber),
		};
		this.seqNumber += 1;
		return commit;
	}
}
