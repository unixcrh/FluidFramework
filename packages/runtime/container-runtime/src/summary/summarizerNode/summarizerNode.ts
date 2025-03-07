/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import {
	ISummarizerNode,
	ISummarizerNodeConfig,
	ISummarizeResult,
	ISummaryTreeWithStats,
	CreateChildSummarizerNodeParam,
	CreateSummarizerNodeSource,
	SummarizeInternalFn,
	ITelemetryContext,
	IExperimentalIncrementalSummaryContext,
} from "@fluidframework/runtime-definitions";
import {
	ISequencedDocumentMessage,
	SummaryType,
	ISnapshotTree,
	SummaryObject,
} from "@fluidframework/protocol-definitions";
import { ITelemetryErrorEvent, ITelemetryLogger } from "@fluidframework/common-definitions";
import { assert, unreachableCase } from "@fluidframework/common-utils";
import {
	convertToSummaryTree,
	calculateStats,
	mergeStats,
	ReadAndParseBlob,
} from "@fluidframework/runtime-utils";
import {
	ChildLogger,
	LoggingError,
	PerformanceEvent,
	TelemetryDataTag,
} from "@fluidframework/telemetry-utils";
import {
	EscapedPath,
	ICreateChildDetails,
	IFetchSnapshotResult,
	IInitialSummary,
	ISummarizerNodeRootContract,
	parseSummaryForSubtrees,
	parseSummaryTreeForSubtrees,
	RefreshSummaryResult,
	SummaryNode,
} from "./summarizerNodeUtils";

export interface IRootSummarizerNode extends ISummarizerNode, ISummarizerNodeRootContract {}

/**
 * Encapsulates the summarizing work and state of an individual tree node in the
 * summary tree. It tracks changes and allows for optimizations when unchanged, or
 * can allow for fallback summaries to be generated when an error is encountered.
 * Usage is for the root node to call startSummary first to begin tracking a WIP
 * (work in progress) summary. Then all nodes will call summarize to summaries their
 * individual parts. Once completed and uploaded to storage, the root node will call
 * completeSummary or clearSummary to clear the WIP summary tracking state if something
 * went wrong. The SummarizerNodes will track all pending summaries that have been
 * recorded by the completeSummary call. When one of them is acked, the root node should
 * call refreshLatestSummary to inform the tree of SummarizerNodes of the new baseline
 * latest successful summary.
 */
export class SummarizerNode implements IRootSummarizerNode {
	/**
	 * The reference sequence number of the most recent acked summary.
	 * Returns 0 if there is not yet an acked summary.
	 */
	public get referenceSequenceNumber() {
		return this._latestSummary?.referenceSequenceNumber ?? 0;
	}

	protected readonly children = new Map<string, SummarizerNode>();
	protected readonly pendingSummaries = new Map<string, SummaryNode>();
	protected wipReferenceSequenceNumber: number | undefined;
	private wipLocalPaths: { localPath: EscapedPath; additionalPath?: EscapedPath } | undefined;
	private wipSkipRecursion = false;

	protected readonly logger: ITelemetryLogger;

	/**
	 * Do not call constructor directly.
	 * Use createRootSummarizerNode to create root node, or createChild to create child nodes.
	 */
	public constructor(
		baseLogger: ITelemetryLogger,
		private readonly summarizeInternalFn: SummarizeInternalFn,
		config: ISummarizerNodeConfig,
		private _changeSequenceNumber: number,
		/** Undefined means created without summary */
		private _latestSummary?: SummaryNode,
		private readonly initialSummary?: IInitialSummary,
		protected wipSummaryLogger?: ITelemetryLogger,
		/** A unique id of this node to be logged when sending telemetry. */
		protected telemetryNodeId?: string,
	) {
		this.canReuseHandle = config.canReuseHandle ?? true;
		// All logs posted by the summarizer node should include the telemetryNodeId.
		this.logger = ChildLogger.create(baseLogger, undefined /* namespace */, {
			all: {
				id: {
					tag: TelemetryDataTag.CodeArtifact,
					value: this.telemetryNodeId,
				},
			},
		});
	}

	public startSummary(referenceSequenceNumber: number, summaryLogger: ITelemetryLogger) {
		assert(
			this.wipSummaryLogger === undefined,
			0x19f /* "wipSummaryLogger should not be set yet in startSummary" */,
		);
		assert(
			this.wipReferenceSequenceNumber === undefined,
			0x1a0 /* "Already tracking a summary" */,
		);

		this.wipSummaryLogger = summaryLogger;

		for (const child of this.children.values()) {
			child.startSummary(referenceSequenceNumber, this.wipSummaryLogger);
		}
		this.wipReferenceSequenceNumber = referenceSequenceNumber;
	}

	public async summarize(
		fullTree: boolean,
		trackState: boolean = true,
		telemetryContext?: ITelemetryContext,
	): Promise<ISummarizeResult> {
		assert(
			this.isSummaryInProgress(),
			0x1a1 /* "summarize should not be called when not tracking the summary" */,
		);
		assert(
			this.wipSummaryLogger !== undefined,
			0x1a2 /* "wipSummaryLogger should have been set in startSummary or ctor" */,
		);

		// Try to reuse the tree if unchanged
		if (this.canReuseHandle && !fullTree && !this.hasChanged()) {
			const latestSummary = this._latestSummary;
			if (latestSummary !== undefined) {
				this.wipLocalPaths = {
					localPath: latestSummary.localPath,
					additionalPath: latestSummary.additionalPath,
				};
				this.wipSkipRecursion = true;
				const stats = mergeStats();
				stats.handleNodeCount++;
				return {
					summary: {
						type: SummaryType.Handle,
						handle: latestSummary.fullPath.path,
						handleType: SummaryType.Tree,
					},
					stats,
				};
			}
		}

		// This assert is the same the other 0a1x1 assert `isSummaryInProgress`, the only difference is that typescript
		// complains if this assert isn't done this way
		assert(
			this.wipReferenceSequenceNumber !== undefined,
			"Summarize should not be called when not tracking the summary",
		);
		const incrementalSummaryContext: IExperimentalIncrementalSummaryContext | undefined =
			this._latestSummary !== undefined
				? {
						summarySequenceNumber: this.wipReferenceSequenceNumber,
						latestSummarySequenceNumber: this._latestSummary.referenceSequenceNumber,
						// TODO: remove summaryPath
						summaryPath: this._latestSummary.fullPath.path,
				  }
				: undefined;

		const result = await this.summarizeInternalFn(
			fullTree,
			true,
			telemetryContext,
			incrementalSummaryContext,
		);
		this.wipLocalPaths = { localPath: EscapedPath.create(result.id) };
		if (result.pathPartsForChildren !== undefined) {
			this.wipLocalPaths.additionalPath = EscapedPath.createAndConcat(
				result.pathPartsForChildren,
			);
		}
		return { summary: result.summary, stats: result.stats };
	}

	/**
	 * Complete the WIP summary for the given proposalHandle
	 */
	public completeSummary(proposalHandle: string) {
		this.completeSummaryCore(proposalHandle, undefined, false);
	}

	/**
	 * Recursive implementation for completeSummary, with additional internal-only parameters
	 */
	protected completeSummaryCore(
		proposalHandle: string,
		parentPath: EscapedPath | undefined,
		parentSkipRecursion: boolean,
	) {
		assert(
			this.wipSummaryLogger !== undefined,
			0x1a3 /* "wipSummaryLogger should have been set in startSummary or ctor" */,
		);
		assert(this.wipReferenceSequenceNumber !== undefined, 0x1a4 /* "Not tracking a summary" */);
		let localPathsToUse = this.wipLocalPaths;

		if (parentSkipRecursion) {
			const latestSummary = this._latestSummary;
			if (latestSummary !== undefined) {
				// This case the parent node created a failure summary or was reused.
				// This node and all children should only try to reference their path
				// by its last known good state in the actual summary tree.
				// If parent fails or is reused, the child summarize is not called so
				// it did not get a chance to change its paths.
				// In this case, essentially only propagate the new summary ref seq num.
				localPathsToUse = {
					localPath: latestSummary.localPath,
					additionalPath: latestSummary.additionalPath,
				};
			} else {
				// This case the child is added after the latest non-failure summary.
				// This node and all children should consider themselves as still not
				// having a successful summary yet.
				// We cannot "reuse" this node if unchanged since that summary, because
				// handles will be unable to point to that node. It never made it to the
				// tree itself, and only exists as an attach op in the _outstandingOps.
				this.clearSummary();
				return;
			}
		}

		/**
		 * The absence of wip local path indicates that summarize was not called for this node. This can happen if:
		 * 1. A child node was created after summarize was already called on the parent. For example, a data store
		 * is realized (loaded) after summarize was called on it creating summarizer nodes for its DDSes. In this case,
		 * parentSkipRecursion will be true and the if block above would handle it.
		 * 2. A new node was created but summarize was never called on it. This can mean that the summary that is
		 * generated may not have the data from this node. We should not continue, log and throw an error. This
		 * will help us identify these cases and take appropriate action.
		 */
		if (localPathsToUse === undefined) {
			this.throwUnexpectedError({
				eventName: "NodeNotSummarized",
				proposalHandle,
			});
		}

		const summary = new SummaryNode({
			...localPathsToUse,
			referenceSequenceNumber: this.wipReferenceSequenceNumber,
			basePath: parentPath,
		});
		const fullPathForChildren = summary.fullPathForChildren;
		for (const child of this.children.values()) {
			child.completeSummaryCore(
				proposalHandle,
				fullPathForChildren,
				this.wipSkipRecursion || parentSkipRecursion,
			);
		}
		// Note that this overwrites existing pending summary with
		// the same proposalHandle. If proposalHandle is something like
		// a hash or unique identifier, this should be fine. If storage
		// can return the same proposalHandle for a different summary,
		// this should still be okay, because we should be proposing the
		// newer one later which would have to overwrite the previous one.
		this.pendingSummaries.set(proposalHandle, summary);
		this.clearSummary();
	}

	public clearSummary() {
		this.wipReferenceSequenceNumber = undefined;
		this.wipLocalPaths = undefined;
		this.wipSkipRecursion = false;
		this.wipSummaryLogger = undefined;
		for (const child of this.children.values()) {
			child.clearSummary();
		}
	}

	/**
	 * Refreshes the latest summary tracked by this node. If we have a pending summary for the given proposal handle,
	 * it becomes the latest summary. If the current summary is already ahead (e.g., loaded from a service summary),
	 * we skip the update. Otherwise, we fetch the latest snapshot and update latest summary based off of that.
	 *
	 * @returns A RefreshSummaryResult type which returns information based on the following three scenarios:
	 *
	 * 1. The latest summary was not updated.
	 *
	 * 2. The latest summary was updated and the summary corresponding to the params was being tracked.
	 *
	 * 3. The latest summary was updated but the summary corresponding to the params was not tracked. In this
	 * case, the latest summary is updated based on the downloaded snapshot which is also returned.
	 */
	public async refreshLatestSummary(
		proposalHandle: string | undefined,
		summaryRefSeq: number,
		fetchLatestSnapshot: () => Promise<IFetchSnapshotResult>,
		readAndParseBlob: ReadAndParseBlob,
		correlatedSummaryLogger: ITelemetryLogger,
	): Promise<RefreshSummaryResult> {
		const eventProps: {
			proposalHandle: string | undefined;
			summaryRefSeq: number;
			referenceSequenceNumber: number;
			latestSummaryUpdated?: boolean;
			wasSummaryTracked?: boolean;
		} = {
			proposalHandle,
			summaryRefSeq,
			referenceSequenceNumber: this.referenceSequenceNumber,
		};
		return PerformanceEvent.timedExecAsync(
			this.logger,
			{
				eventName: "refreshLatestSummary",
				...eventProps,
			},
			async (event) => {
				// Refresh latest summary should not happen while a summary is in progress. If it does, it can result
				// in inconsistent state, so, we should not continue;
				if (this.isSummaryInProgress()) {
					throw new LoggingError("UnexpectedRefreshDuringSummarize", {
						inProgressSummaryRefSeq: this.wipReferenceSequenceNumber,
					});
				}

				if (proposalHandle !== undefined) {
					const maybeSummaryNode = this.pendingSummaries.get(proposalHandle);

					if (maybeSummaryNode !== undefined) {
						this.refreshLatestSummaryFromPending(
							proposalHandle,
							maybeSummaryNode.referenceSequenceNumber,
						);
						eventProps.wasSummaryTracked = true;
						eventProps.latestSummaryUpdated = true;
						event.end(eventProps);
						return {
							latestSummaryUpdated: true,
							wasSummaryTracked: true,
							summaryRefSeq,
						};
					}

					const props = {
						summaryRefSeq,
						pendingSize: this.pendingSummaries.size ?? undefined,
					};
					this.logger.sendTelemetryEvent({
						eventName: "PendingSummaryNotFound",
						proposalHandle,
						referenceSequenceNumber: this.referenceSequenceNumber,
						details: JSON.stringify(props),
					});
				}

				// If the summary for which refresh is called is older than the latest tracked summary, ignore it.
				if (this.referenceSequenceNumber >= summaryRefSeq) {
					eventProps.latestSummaryUpdated = false;
					event.end(eventProps);
					return { latestSummaryUpdated: false };
				}

				// Fetch the latest snapshot and refresh state from it. Note that we need to use the reference sequence number
				// of the fetched snapshot and not the "summaryRefSeq" that was passed in.
				const { snapshotTree, snapshotRefSeq: fetchedSnapshotRefSeq } =
					await fetchLatestSnapshot();

				// Possible re-entrancy. We may have updated latest summary state while fetching the snapshot. If the fetched
				// snapshot is older than the latest tracked summary, ignore it.
				if (this.referenceSequenceNumber >= fetchedSnapshotRefSeq) {
					eventProps.latestSummaryUpdated = false;
					event.end(eventProps);
					return { latestSummaryUpdated: false };
				}

				await this.refreshLatestSummaryFromSnapshot(
					fetchedSnapshotRefSeq,
					snapshotTree,
					undefined,
					EscapedPath.create(""),
					correlatedSummaryLogger,
					readAndParseBlob,
				);

				eventProps.latestSummaryUpdated = true;
				eventProps.wasSummaryTracked = false;
				eventProps.summaryRefSeq = fetchedSnapshotRefSeq;
				event.end(eventProps);
				return {
					latestSummaryUpdated: true,
					wasSummaryTracked: false,
					snapshotTree,
					summaryRefSeq: fetchedSnapshotRefSeq,
				};
			},
			{ start: true, end: true, cancel: "error" },
		);
	}
	/**
	 * Called when we get an ack from the server for a summary we've just sent. Updates the reference state of this node
	 * from the state in the pending summary queue.
	 * @param proposalHandle - Handle for the current proposal.
	 * @param referenceSequenceNumber -  reference sequence number of sent summary.
	 */
	protected refreshLatestSummaryFromPending(
		proposalHandle: string,
		referenceSequenceNumber: number,
	): void {
		const summaryNode = this.pendingSummaries.get(proposalHandle);
		if (summaryNode === undefined) {
			// This should only happen if parent skipped recursion AND no prior summary existed.
			assert(
				this._latestSummary === undefined,
				0x1a6 /* "Not found pending summary, but this node has previously completed a summary" */,
			);
			return;
		} else {
			assert(
				referenceSequenceNumber === summaryNode.referenceSequenceNumber,
				0x1a7 /* Pending summary reference sequence number should be consistent */,
			);

			// Clear earlier pending summaries
			this.pendingSummaries.delete(proposalHandle);
		}

		this.refreshLatestSummaryCore(referenceSequenceNumber);

		this._latestSummary = summaryNode;
		// Propagate update to all child nodes
		for (const child of this.children.values()) {
			child.refreshLatestSummaryFromPending(proposalHandle, referenceSequenceNumber);
		}
	}

	protected async refreshLatestSummaryFromSnapshot(
		referenceSequenceNumber: number,
		snapshotTree: ISnapshotTree,
		basePath: EscapedPath | undefined,
		localPath: EscapedPath,
		correlatedSummaryLogger: ITelemetryLogger,
		readAndParseBlob: ReadAndParseBlob,
	): Promise<void> {
		// Possible re-entrancy. If we have already seen a summary later than this one, ignore it.
		if (this.referenceSequenceNumber >= referenceSequenceNumber) {
			return;
		}

		this.refreshLatestSummaryCore(referenceSequenceNumber);

		this._latestSummary = new SummaryNode({
			referenceSequenceNumber,
			basePath,
			localPath,
		});

		const pathParts: string[] = [];
		const { childrenTree, childrenPathPart } = parseSummaryForSubtrees(snapshotTree);
		if (childrenPathPart !== undefined) {
			pathParts.push(childrenPathPart);
		}

		if (pathParts.length > 0) {
			this._latestSummary.additionalPath = EscapedPath.createAndConcat(pathParts);
		}

		// Propagate update to all child nodes
		const pathForChildren = this._latestSummary.fullPathForChildren;
		await Promise.all(
			Array.from(this.children)
				.filter(([id]) => {
					// Assuming subtrees missing from snapshot are newer than the snapshot,
					// but might be nice to assert this using earliest seq for node.
					return childrenTree.trees[id] !== undefined;
				})
				.map(async ([id, child]) => {
					return child.refreshLatestSummaryFromSnapshot(
						referenceSequenceNumber,
						childrenTree.trees[id],
						pathForChildren,
						EscapedPath.create(id),
						correlatedSummaryLogger,
						readAndParseBlob,
					);
				}),
		);
	}

	private refreshLatestSummaryCore(referenceSequenceNumber: number): void {
		for (const [key, value] of this.pendingSummaries) {
			if (value.referenceSequenceNumber < referenceSequenceNumber) {
				this.pendingSummaries.delete(key);
			}
		}
	}

	public updateBaseSummaryState(snapshot: ISnapshotTree) {
		// Check base summary to see if it has any additional path parts
		// separating child SummarizerNodes. Checks for .channels subtrees.
		const { childrenPathPart } = parseSummaryForSubtrees(snapshot);
		if (childrenPathPart !== undefined && this._latestSummary !== undefined) {
			this._latestSummary.additionalPath = EscapedPath.create(childrenPathPart);
		}
	}

	public recordChange(op: ISequencedDocumentMessage): void {
		this.invalidate(op.sequenceNumber);
	}

	public invalidate(sequenceNumber: number): void {
		if (sequenceNumber > this._changeSequenceNumber) {
			this._changeSequenceNumber = sequenceNumber;
		}
	}

	/**
	 * True if a change has been recorded with sequence number exceeding
	 * the latest successfully acked summary reference sequence number.
	 * False implies that the previous summary can be reused.
	 */
	protected hasChanged(): boolean {
		return this._changeSequenceNumber > this.referenceSequenceNumber;
	}

	public get latestSummary(): Readonly<SummaryNode> | undefined {
		return this._latestSummary;
	}

	protected readonly canReuseHandle: boolean;

	public createChild(
		/** Summarize function */
		summarizeInternalFn: SummarizeInternalFn,
		/** Initial id or path part of this node */
		id: string,
		/**
		 * Information needed to create the node.
		 * If it is from a base summary, it will assert that a summary has been seen.
		 * Attach information if it is created from an attach op.
		 */
		createParam: CreateChildSummarizerNodeParam,
		config: ISummarizerNodeConfig = {},
	): ISummarizerNode {
		assert(!this.children.has(id), 0x1ab /* "Create SummarizerNode child already exists" */);

		const createDetails: ICreateChildDetails = this.getCreateDetailsForChild(id, createParam);
		const child = new SummarizerNode(
			this.logger,
			summarizeInternalFn,
			config,
			createDetails.changeSequenceNumber,
			createDetails.latestSummary,
			createDetails.initialSummary,
			this.wipSummaryLogger,
			createDetails.telemetryNodeId,
		);

		// There may be additional state that has to be updated in this child. For example, if a summary is being
		// tracked, the child's summary tracking state needs to be updated too. Same goes for pendingSummaries we might
		// have outstanding on the parent in case we realize nodes in between Summary Op and Summary Ack.
		this.maybeUpdateChildState(child, id);

		this.children.set(id, child);
		return child;
	}

	public getChild(id: string): ISummarizerNode | undefined {
		return this.children.get(id);
	}

	/**
	 * Returns the details needed to create a child node.
	 * @param id - Initial id or path part of the child node.
	 * @param createParam - Information needed to create the node.
	 * @returns the details needed to create the child node.
	 */
	protected getCreateDetailsForChild(
		id: string,
		createParam: CreateChildSummarizerNodeParam,
	): ICreateChildDetails {
		let initialSummary: IInitialSummary | undefined;
		let latestSummary: SummaryNode | undefined;
		let changeSequenceNumber: number;

		const parentLatestSummary = this._latestSummary;
		switch (createParam.type) {
			case CreateSummarizerNodeSource.FromAttach: {
				if (
					parentLatestSummary !== undefined &&
					createParam.sequenceNumber <= parentLatestSummary.referenceSequenceNumber
				) {
					// Prioritize latest summary if it was after this node was attached.
					latestSummary = parentLatestSummary.createForChild(id);
				} else {
					const summary = convertToSummaryTree(
						createParam.snapshot,
					) as ISummaryTreeWithStats;
					initialSummary = {
						sequenceNumber: createParam.sequenceNumber,
						id,
						summary,
					};
				}
				changeSequenceNumber = createParam.sequenceNumber;
				break;
			}
			case CreateSummarizerNodeSource.FromSummary: {
				if (this.initialSummary === undefined) {
					assert(
						!!parentLatestSummary,
						0x1ac /* "Cannot create child from summary if parent does not have latest summary" */,
					);
				}
				// fallthrough to local
			}
			case CreateSummarizerNodeSource.Local: {
				const parentInitialSummary = this.initialSummary;
				if (parentInitialSummary !== undefined) {
					let childSummary: SummaryObject | undefined;
					if (parentInitialSummary.summary !== undefined) {
						const { childrenTree } = parseSummaryTreeForSubtrees(
							parentInitialSummary.summary.summary,
						);
						assert(
							childrenTree.type === SummaryType.Tree,
							0x1d6 /* "Parent summary object is not a tree" */,
						);
						childSummary = childrenTree.tree[id];
					}
					if (createParam.type === CreateSummarizerNodeSource.FromSummary) {
						// Locally created would not have differential subtree.
						assert(!!childSummary, 0x1ad /* "Missing child summary tree" */);
					}
					let childSummaryWithStats: ISummaryTreeWithStats | undefined;
					if (childSummary !== undefined) {
						assert(
							childSummary.type === SummaryType.Tree,
							0x1ae /* "Child summary object is not a tree" */,
						);
						childSummaryWithStats = {
							summary: childSummary,
							stats: calculateStats(childSummary),
						};
					}
					initialSummary = {
						sequenceNumber: parentInitialSummary.sequenceNumber,
						id,
						summary: childSummaryWithStats,
					};
				}
				latestSummary = parentLatestSummary?.createForChild(id);
				changeSequenceNumber = parentLatestSummary?.referenceSequenceNumber ?? -1;
				break;
			}
			default: {
				const type = (createParam as unknown as CreateChildSummarizerNodeParam).type;
				unreachableCase(createParam, `Unexpected CreateSummarizerNodeSource: ${type}`);
			}
		}

		const childtelemetryNodeId = `${this.telemetryNodeId ?? ""}/${id}`;

		return {
			initialSummary,
			latestSummary,
			changeSequenceNumber,
			telemetryNodeId: childtelemetryNodeId,
		};
	}

	/**
	 * Updates the state of the child if required. For example, if a summary is currently being  tracked, the child's
	 * summary tracking state needs to be updated too.
	 * Also, in case a child node gets realized in between Summary Op and Summary Ack, let's initialize the child's
	 * pending summary as well.
	 * @param child - The child node whose state is to be updated.
	 * @param id - Initial id or path part of this node
	 *
	 */
	protected maybeUpdateChildState(child: SummarizerNode, id: string) {
		// If a summary is in progress, this child was created after the summary started. So, we need to update the
		// child's summary state as well.
		if (this.isSummaryInProgress()) {
			child.wipReferenceSequenceNumber = this.wipReferenceSequenceNumber;
		}
		// In case we have pending summaries on the parent, let's initialize it on the child.
		if (child._latestSummary !== undefined) {
			for (const [key, value] of this.pendingSummaries.entries()) {
				const newLatestSummaryNode = new SummaryNode({
					referenceSequenceNumber: value.referenceSequenceNumber,
					basePath: child._latestSummary.basePath,
					localPath: child._latestSummary.localPath,
				});

				child.addPendingSummary(key, newLatestSummaryNode);
			}
		}
	}

	protected addPendingSummary(key: string, summary: SummaryNode) {
		this.pendingSummaries.set(key, summary);
	}

	/**
	 * Tells whether summary tracking is in progress. True if "startSummary" API is called before summarize.
	 */
	public isSummaryInProgress(): boolean {
		return this.wipReferenceSequenceNumber !== undefined;
	}

	/**
	 * Creates and throws an error due to unexpected conditions.
	 */
	protected throwUnexpectedError(eventProps: ITelemetryErrorEvent): never {
		const error = new LoggingError(eventProps.eventName, {
			...eventProps,
			referenceSequenceNumber: this.wipReferenceSequenceNumber,
			id: {
				tag: TelemetryDataTag.CodeArtifact,
				value: this.telemetryNodeId,
			},
		});
		this.logger.sendErrorEvent(eventProps, error);
		throw error;
	}
}

/**
 * Creates a root summarizer node.
 * @param logger - Logger to use within SummarizerNode
 * @param summarizeInternalFn - Function to generate summary
 * @param changeSequenceNumber - Sequence number of latest change to new node/subtree
 * @param referenceSequenceNumber - Reference sequence number of last acked summary,
 * or undefined if not loaded from summary
 * @param config - Configure behavior of summarizer node
 */
export const createRootSummarizerNode = (
	logger: ITelemetryLogger,
	summarizeInternalFn: SummarizeInternalFn,
	changeSequenceNumber: number,
	referenceSequenceNumber: number | undefined,
	config: ISummarizerNodeConfig = {},
): IRootSummarizerNode =>
	new SummarizerNode(
		logger,
		summarizeInternalFn,
		config,
		changeSequenceNumber,
		referenceSequenceNumber === undefined
			? undefined
			: SummaryNode.createForRoot(referenceSequenceNumber),
		undefined /* initialSummary */,
		undefined /* wipSummaryLogger */,
		"" /* telemetryNodeId */,
	);
