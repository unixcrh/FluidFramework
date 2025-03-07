/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { unreachableCase } from "@fluidframework/common-utils";
import { FieldKey, Value } from "./types";
import * as Delta from "./delta";

/**
 * Implementation notes:
 *
 * Because visitors are based on describing changes at some location in the tree (with the exception of "build"),
 * we want to ensure that visitors visit changes in an order that guarantees all changes are describable in terms
 * of some position in the tree. This means that we need to detach content bottom-up and attach content top-down.
 * Note that while the attach positions are expressed top-down, there is still a bottom-up spirit to building trees
 * that are being inserted.
 *
 * The second challenge, is that of the inability of the visitor to move-in content that has yet to be moved-out.
 * This leads to a two-pass algorithm, but there are two degrees for freedom to consider:
 *
 * 1. Whether inserts should be performed in the first pass whenever possible (some are not: inserts below a move-ins
 * for which we have not yet seen the matching move-out).
 * Pros: The path above the insertion point is walked once instead of twice
 * Cons: The paths within the inserted content risk being walked twice instead of once (once for building the content,
 * once for traversing the tree to reach move-in marks in the second phase).
 *
 * 2. Whether move-ins for which we have the move-out content should be performed in the first pass.
 * Pros: The path above the move-in point is walked once instead of twice
 * Cons: We now have to record which of the move-ins we did not perform in the first pass. We could build a trie of
 * those to reduce the amount of sifting we have to do on the second pass.
 *
 * The presence of a move table, which lists the src and dst paths for each move, could be leveraged to make some of
 * these option more efficient:
 *
 * - If inserts are allowed in the first pass and move-ins are not allowed in the first pass, then the move table
 * describes exactly which parts of the delta need applying in the second pass.
 *
 * - If inserts and move-ins are allowed in the first pass then having a boolean flag for each entry in the move table
 * that describes whether the move has been attached, or having a set for that describes which entries remain, would
 * describe which parts of the delta  need applying in the second pass.
 *
 * Current implementation:
 *
 * - First pass: performs inserts top-down and move-outs bottom-up (it also performs value updates)
 *
 * - Second pass: performs move-ins top-down and deletes bottom-up
 *
 * - Skips the second pass if no moves or deletes were encountered in the first pass
 *
 * Future work:
 *
 * - Allow the visitor to ignore changes to regions of the tree that are not of interest to it (for partial checkouts).
 *
 * - Avoid moving the visitor through parts of the document that do not need changing in the current pass.
 * This could be done by assigning IDs to nodes of interest and asking the visitor to jump to these nodes in order to edit them.
 *
 * - Leverage the move table if one ever gets added to Delta
 */

/**
 * Crawls the given `delta`, calling `visitor`'s callback for each change encountered.
 * Each successive call to the visitor callbacks assumes that the change described by earlier calls have been applied
 * to the document tree. For example, for a change that deletes the first and third node of a field, the visitor calls
 * will pass indices 0 and 1 respectively.
 * @param delta - The delta to be crawled.
 * @param visitor - The object to notify of the changes encountered.
 */
export function visitDelta(delta: Delta.Root, visitor: DeltaVisitor): void {
	const modsToMovedTrees = new Map<Delta.MoveId, Delta.HasModifications>();
	const containsMovesOrDeletes = visitFieldMarks(delta, visitor, {
		func: firstPass,
		applyValueChanges: true,
		modsToMovedTrees,
	});
	if (containsMovesOrDeletes) {
		visitFieldMarks(delta, visitor, {
			func: secondPass,
			applyValueChanges: false,
			modsToMovedTrees,
		});
	}
}

export interface DeltaVisitor {
	onDelete(index: number, count: number): void;
	onInsert(index: number, content: readonly Delta.ProtoNode[]): void;
	onMoveOut(index: number, count: number, id: Delta.MoveId): void;
	onMoveIn(index: number, count: number, id: Delta.MoveId): void;
	onSetValue(value: Value): void;
	// TODO: better align this with ITreeCursor:
	// maybe rename its up and down to enter / exit? Maybe Also)?
	// Maybe also have cursor have "current field key" state to allow better handling of empty fields and better match
	// this visitor?
	enterNode(index: number): void;
	exitNode(index: number): void;
	enterField(key: FieldKey): void;
	exitField(key: FieldKey): void;
}

interface PassConfig {
	readonly func: Pass;
	readonly applyValueChanges: boolean;
	readonly modsToMovedTrees: Map<Delta.MoveId, Delta.HasModifications>;
}

type Pass = (delta: Delta.MarkList, visitor: DeltaVisitor, config: PassConfig) => boolean;

function visitFieldMarks(
	fields: Delta.FieldMarks,
	visitor: DeltaVisitor,
	config: PassConfig,
): boolean {
	let containsMovesOrDeletes = false;
	for (const [key, field] of fields) {
		visitor.enterField(key);
		const result = config.func(field, visitor, config);
		containsMovesOrDeletes ||= result;
		visitor.exitField(key);
	}
	return containsMovesOrDeletes;
}

function visitModify(
	index: number,
	modify: Delta.HasModifications,
	visitor: DeltaVisitor,
	config: PassConfig,
): boolean {
	let containsMovesOrDeletes = false;
	// Note that `hasOwnProperty` returns true for properties that are present on the object even if they
	// are set to `undefined. This is leveraged here to represent the fact that the value should be set to
	// `undefined` as opposed to leaving the value untouched.
	const hasValueChange =
		config.applyValueChanges && Object.prototype.hasOwnProperty.call(modify, "setValue");

	if (hasValueChange || modify.fields !== undefined) {
		visitor.enterNode(index);
		if (hasValueChange) {
			visitor.onSetValue(modify.setValue);
		}
		if (modify.fields !== undefined) {
			const result = visitFieldMarks(modify.fields, visitor, config);
			containsMovesOrDeletes ||= result;
		}
		visitor.exitNode(index);
	}
	return containsMovesOrDeletes;
}

function firstPass(delta: Delta.MarkList, visitor: DeltaVisitor, config: PassConfig): boolean {
	let containsMoves = false;
	let index = 0;
	for (const mark of delta) {
		if (typeof mark === "number") {
			// Untouched nodes
			index += mark;
		} else {
			let result = false;
			// Inline into `switch(mark.type)` once we upgrade to TS 4.7
			const type = mark.type;
			switch (type) {
				case Delta.MarkType.Delete:
					// Handled in the second pass
					visitModify(index, mark, visitor, config);
					index += mark.count;
					result = true;
					break;
				case Delta.MarkType.MoveOut:
					result = visitModify(index, mark, visitor, config);
					if (result) {
						config.modsToMovedTrees.set(mark.moveId, mark);
					}
					visitor.onMoveOut(index, mark.count, mark.moveId);
					break;
				case Delta.MarkType.Modify:
					result = visitModify(index, mark, visitor, config);
					index += 1;
					break;
				case Delta.MarkType.Insert:
					visitor.onInsert(index, mark.content);
					result = visitModify(index, mark, visitor, config);
					index += mark.content.length;
					break;
				case Delta.MarkType.MoveIn:
					// Handled in the second pass
					result = true;
					break;
				default:
					unreachableCase(type);
			}
			containsMoves ||= result;
		}
	}
	return containsMoves;
}

function secondPass(delta: Delta.MarkList, visitor: DeltaVisitor, config: PassConfig): boolean {
	let index = 0;
	for (const mark of delta) {
		if (typeof mark === "number") {
			// Untouched nodes
			index += mark;
		} else {
			// Inline into the `switch(...)` once we upgrade to TS 4.7
			const type = mark.type;
			switch (type) {
				case Delta.MarkType.Delete:
					visitModify(index, mark, visitor, config);
					visitor.onDelete(index, mark.count);
					break;
				case Delta.MarkType.MoveOut:
					// Handled in the first pass
					break;
				case Delta.MarkType.Modify:
					visitModify(index, mark, visitor, config);
					index += 1;
					break;
				case Delta.MarkType.Insert:
					// Handled in the first pass
					index += mark.content.length;
					break;
				case Delta.MarkType.MoveIn: {
					visitor.onMoveIn(index, mark.count, mark.moveId);
					if (mark.count === 1) {
						const modify = config.modsToMovedTrees.get(mark.moveId);
						if (modify !== undefined) {
							visitModify(index, modify, visitor, config);
						}
					}
					index += mark.count;
					break;
				}
				default:
					unreachableCase(type);
			}
		}
	}
	return false;
}
