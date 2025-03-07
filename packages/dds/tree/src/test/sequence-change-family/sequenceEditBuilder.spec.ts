/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { strict as assert } from "assert";
import { jsonString } from "../../domains";
import { AnchorSet, Delta, FieldKey, ITreeCursorSynchronous, UpPath } from "../../core";
import { singleTextCursor } from "../../feature-libraries";
import {
	sequenceChangeFamily,
	SequenceEditBuilder,
	// eslint-disable-next-line import/no-internal-modules
} from "../../feature-libraries/sequence-change-family";
import { brand, brandOpaque } from "../../util";

const rootKey = brand<FieldKey>("root");
const detachedKey = brand<FieldKey>("detached");
const fooKey = brand<FieldKey>("foo");
const barKey = brand<FieldKey>("bar");

const root: UpPath = {
	parent: undefined,
	parentField: rootKey,
	parentIndex: 0,
};

const detached: UpPath = {
	parent: undefined,
	parentField: detachedKey,
	parentIndex: 0,
};

const root_foo2: UpPath = {
	parent: root,
	parentField: fooKey,
	parentIndex: 2,
};

const root_bar2: UpPath = {
	parent: root,
	parentField: barKey,
	parentIndex: 2,
};

const root_foo17: UpPath = {
	parent: root,
	parentField: fooKey,
	parentIndex: 17,
};

const root_foo2_foo5: UpPath = {
	parent: root_foo2,
	parentField: fooKey,
	parentIndex: 5,
};

const root_foo17_foo5: UpPath = {
	parent: root_foo17,
	parentField: fooKey,
	parentIndex: 5,
};

const root_bar2_bar5: UpPath = {
	parent: root_bar2,
	parentField: barKey,
	parentIndex: 5,
};

const root_foo2_foo5_foo7: UpPath = {
	parent: root_foo2_foo5,
	parentField: fooKey,
	parentIndex: 7,
};

const root_bar2_bar5_bar7: UpPath = {
	parent: root_bar2_bar5,
	parentField: barKey,
	parentIndex: 7,
};

const nodeX = { type: jsonString.name, value: "X" };
const nodeXCursor: ITreeCursorSynchronous = singleTextCursor(nodeX);
const moveId = brandOpaque<Delta.MoveId>(0);
const moveId2 = brandOpaque<Delta.MoveId>(1);

function makeBuilderToDeltas(): {
	deltas: Delta.Root[];
	builder: SequenceEditBuilder;
} {
	const deltas: Delta.Root[] = [];
	const builder = new SequenceEditBuilder(
		(change) => deltas.push(sequenceChangeFamily.intoDelta(change)),
		new AnchorSet(),
	);
	return { deltas, builder };
}

describe("SequenceEditBuilder", () => {
	it("Does not produces changes if no editing calls are made to it", () => {
		const { deltas } = makeBuilderToDeltas();
		assert.deepEqual(deltas, []);
	});

	it("Can set the root node value", () => {
		const { builder, deltas } = makeBuilderToDeltas();
		builder.setValue(root, 42);
		const expected: Delta.Root = new Map([
			[
				rootKey,
				[
					{
						type: Delta.MarkType.Modify,
						setValue: 42,
					},
				],
			],
		]);
		assert.deepEqual(deltas, [expected]);
	});

	it("Can set a child node value", () => {
		const { builder, deltas } = makeBuilderToDeltas();
		const expected: Delta.Root = new Map([
			[
				rootKey,
				[
					{
						type: Delta.MarkType.Modify,
						fields: new Map([
							[
								fooKey,
								[
									2,
									{
										type: Delta.MarkType.Modify,
										fields: new Map([
											[
												fooKey,
												[
													5,
													{
														type: Delta.MarkType.Modify,
														setValue: 42,
													},
												],
											],
										]),
									},
								],
							],
						]),
					},
				],
			],
		]);
		builder.setValue(root_foo2_foo5, 42);
		assert.deepEqual(deltas, [expected]);
	});

	it("Can insert a root node", () => {
		const { builder, deltas } = makeBuilderToDeltas();
		const expected: Delta.Root = new Map([
			[
				rootKey,
				[
					{
						type: Delta.MarkType.Insert,
						content: [nodeXCursor],
					},
				],
			],
		]);
		builder.insert(root, singleTextCursor(nodeX));
		assert.deepEqual(deltas, [expected]);
	});

	it("Can insert a child node", () => {
		const { builder, deltas } = makeBuilderToDeltas();
		const expected: Delta.Root = new Map([
			[
				rootKey,
				[
					{
						type: Delta.MarkType.Modify,
						fields: new Map([
							[
								fooKey,
								[
									2,
									{
										type: Delta.MarkType.Modify,
										fields: new Map([
											[
												fooKey,
												[
													5,
													{
														type: Delta.MarkType.Insert,
														content: [nodeXCursor],
													},
												],
											],
										]),
									},
								],
							],
						]),
					},
				],
			],
		]);
		builder.insert(root_foo2_foo5, singleTextCursor(nodeX));
		assert.deepEqual(deltas, [expected]);
	});

	it("Can delete a root node", () => {
		const { builder, deltas } = makeBuilderToDeltas();
		const expected: Delta.Root = new Map([
			[
				rootKey,
				[
					{
						type: Delta.MarkType.Delete,
						count: 1,
					},
				],
			],
		]);
		builder.delete(root, 1);
		assert.deepEqual(deltas, [expected]);
	});

	it("Can delete child nodes", () => {
		const { builder, deltas } = makeBuilderToDeltas();
		const expected: Delta.Root = new Map([
			[
				rootKey,
				[
					{
						type: Delta.MarkType.Modify,
						fields: new Map([
							[
								fooKey,
								[
									2,
									{
										type: Delta.MarkType.Modify,
										fields: new Map([
											[
												fooKey,
												[
													5,
													{
														type: Delta.MarkType.Delete,
														count: 10,
													},
												],
											],
										]),
									},
								],
							],
						]),
					},
				],
			],
		]);
		builder.delete(root_foo2_foo5, 10);
		assert.deepEqual(deltas, [expected]);
	});

	it("Can move nodes to the right within a field", () => {
		const { builder, deltas } = makeBuilderToDeltas();
		const expected: Delta.Root = new Map([
			[
				rootKey,
				[
					{
						type: Delta.MarkType.Modify,
						fields: new Map([
							[
								fooKey,
								[
									2,
									{
										type: Delta.MarkType.MoveOut,
										moveId,
										count: 10,
									},
									5,
									{
										type: Delta.MarkType.MoveIn,
										moveId,
										count: 10,
									},
								],
							],
						]),
					},
				],
			],
		]);
		builder.move(root_foo2, 10, root_foo17);
		assert.deepEqual(deltas, [expected]);
	});

	it("Can move nodes to the left within a field", () => {
		const { builder, deltas } = makeBuilderToDeltas();
		const expected: Delta.Root = new Map([
			[
				rootKey,
				[
					{
						type: Delta.MarkType.Modify,
						fields: new Map([
							[
								fooKey,
								[
									2,
									{
										type: Delta.MarkType.MoveIn,
										moveId,
										count: 10,
									},
									15,
									{
										type: Delta.MarkType.MoveOut,
										moveId,
										count: 10,
									},
								],
							],
						]),
					},
				],
			],
		]);
		builder.move(root_foo17, 10, root_foo2);
		assert.deepEqual(deltas, [expected]);
	});

	it("Can move nodes into their own midst", () => {
		const { builder, deltas } = makeBuilderToDeltas();
		const expected: Delta.Root = new Map([
			[
				rootKey,
				[
					{
						type: Delta.MarkType.Modify,
						fields: new Map([
							[
								fooKey,
								[
									2,
									{
										type: Delta.MarkType.MoveOut,
										moveId,
										count: 15,
									},
									{
										type: Delta.MarkType.MoveIn,
										moveId,
										count: 15,
									},
									{
										type: Delta.MarkType.MoveIn,
										moveId: moveId2,
										count: 5,
									},
									{
										type: Delta.MarkType.MoveOut,
										moveId: moveId2,
										count: 5,
									},
								],
							],
						]),
					},
				],
			],
		]);
		builder.move(root_foo2, 20, root_foo17);
		assert.deepEqual(deltas, [expected]);
	});

	it("Can move nodes across fields of the same parent", () => {
		const { builder, deltas } = makeBuilderToDeltas();
		const expected: Delta.Root = new Map([
			[
				rootKey,
				[
					{
						type: Delta.MarkType.Modify,
						fields: new Map([
							[
								fooKey,
								[
									2,
									{
										type: Delta.MarkType.MoveOut,
										moveId,
										count: 10,
									},
								],
							],
							[
								barKey,
								[
									2,
									{
										type: Delta.MarkType.MoveIn,
										moveId,
										count: 10,
									},
								],
							],
						]),
					},
				],
			],
		]);
		builder.move(root_foo2, 10, root_bar2);
		assert.deepEqual(deltas, [expected]);
	});

	it("Can move nodes to the right across subtrees of the same field", () => {
		const { builder, deltas } = makeBuilderToDeltas();
		const expected: Delta.Root = new Map([
			[
				rootKey,
				[
					{
						type: Delta.MarkType.Modify,
						fields: new Map([
							[
								fooKey,
								[
									2,
									{
										type: Delta.MarkType.Modify,
										fields: new Map([
											[
												fooKey,
												[
													5,
													{
														type: Delta.MarkType.MoveOut,
														moveId,
														count: 3,
													},
												],
											],
										]),
									},
									14,
									{
										type: Delta.MarkType.Modify,
										fields: new Map([
											[
												fooKey,
												[
													5,
													{
														type: Delta.MarkType.MoveIn,
														moveId,
														count: 3,
													},
												],
											],
										]),
									},
								],
							],
						]),
					},
				],
			],
		]);
		builder.move(root_foo2_foo5, 3, root_foo17_foo5);
		assert.deepEqual(deltas, [expected]);
	});

	it("Can move nodes to the left across subtrees of the same field", () => {
		const { builder, deltas } = makeBuilderToDeltas();
		const expected: Delta.Root = new Map([
			[
				rootKey,
				[
					{
						type: Delta.MarkType.Modify,
						fields: new Map([
							[
								fooKey,
								[
									2,
									{
										type: Delta.MarkType.Modify,
										fields: new Map([
											[
												fooKey,
												[
													5,
													{
														type: Delta.MarkType.MoveIn,
														moveId,
														count: 3,
													},
												],
											],
										]),
									},
									14,
									{
										type: Delta.MarkType.Modify,
										fields: new Map([
											[
												fooKey,
												[
													5,
													{
														type: Delta.MarkType.MoveOut,
														moveId,
														count: 3,
													},
												],
											],
										]),
									},
								],
							],
						]),
					},
				],
			],
		]);
		builder.move(root_foo17_foo5, 3, root_foo2_foo5);
		assert.deepEqual(deltas, [expected]);
	});

	it("Can move nodes across subtrees of different fields", () => {
		const { builder, deltas } = makeBuilderToDeltas();
		const expected: Delta.Root = new Map([
			[
				rootKey,
				[
					{
						type: Delta.MarkType.Modify,
						fields: new Map([
							[
								fooKey,
								[
									2,
									{
										type: Delta.MarkType.Modify,
										fields: new Map([
											[
												fooKey,
												[
													5,
													{
														type: Delta.MarkType.MoveOut,
														moveId,
														count: 3,
													},
												],
											],
										]),
									},
								],
							],
							[
								barKey,
								[
									2,
									{
										type: Delta.MarkType.Modify,
										fields: new Map([
											[
												barKey,
												[
													5,
													{
														type: Delta.MarkType.MoveIn,
														moveId,
														count: 3,
													},
												],
											],
										]),
									},
								],
							],
						]),
					},
				],
			],
		]);
		builder.move(root_foo2_foo5, 3, root_bar2_bar5);
		assert.deepEqual(deltas, [expected]);
	});

	it("Can move nodes across deep subtrees of different fields", () => {
		const { builder, deltas } = makeBuilderToDeltas();
		const expected: Delta.Root = new Map([
			[
				rootKey,
				[
					{
						type: Delta.MarkType.Modify,
						fields: new Map([
							[
								fooKey,
								[
									2,
									{
										type: Delta.MarkType.Modify,
										fields: new Map([
											[
												fooKey,
												[
													5,
													{
														type: Delta.MarkType.Modify,
														fields: new Map([
															[
																fooKey,
																[
																	7,
																	{
																		type: Delta.MarkType
																			.MoveOut,
																		moveId,
																		count: 3,
																	},
																],
															],
														]),
													},
												],
											],
										]),
									},
								],
							],
							[
								barKey,
								[
									2,
									{
										type: Delta.MarkType.Modify,
										fields: new Map([
											[
												barKey,
												[
													5,
													{
														type: Delta.MarkType.Modify,
														fields: new Map([
															[
																barKey,
																[
																	7,
																	{
																		type: Delta.MarkType.MoveIn,
																		moveId,
																		count: 3,
																	},
																],
															],
														]),
													},
												],
											],
										]),
									},
								],
							],
						]),
					},
				],
			],
		]);
		builder.move(root_foo2_foo5_foo7, 3, root_bar2_bar5_bar7);
		assert.deepEqual(deltas, [expected]);
	});

	it("Can move nodes to a detached tree", () => {
		const { builder, deltas } = makeBuilderToDeltas();
		const expected: Delta.Root = new Map([
			[
				rootKey,
				[
					{
						type: Delta.MarkType.Modify,
						fields: new Map([
							[
								fooKey,
								[
									2,
									{
										type: Delta.MarkType.MoveOut,
										moveId,
										count: 10,
									},
								],
							],
						]),
					},
				],
			],
			[
				detachedKey,
				[
					{
						type: Delta.MarkType.MoveIn,
						moveId,
						count: 10,
					},
				],
			],
		]);
		builder.move(root_foo2, 10, detached);
		assert.deepEqual(deltas, [expected]);
	});

	it("Can move nodes from a detached tree", () => {
		const { builder, deltas } = makeBuilderToDeltas();
		const expected: Delta.Root = new Map([
			[
				rootKey,
				[
					{
						type: Delta.MarkType.Modify,
						fields: new Map([
							[
								fooKey,
								[
									2,
									{
										type: Delta.MarkType.MoveIn,
										moveId,
										count: 10,
									},
								],
							],
						]),
					},
				],
			],
			[
				detachedKey,
				[
					{
						type: Delta.MarkType.MoveOut,
						moveId,
						count: 10,
					},
				],
			],
		]);
		builder.move(detached, 10, root_foo2);
		assert.deepEqual(deltas, [expected]);
	});

	it("Produces one delta for each editing call made to it", () => {
		const { builder, deltas } = makeBuilderToDeltas();
		const expected: Delta.Root[] = [];

		builder.setValue(root, 42);
		expected.push(
			new Map([
				[
					rootKey,
					[
						{
							type: Delta.MarkType.Modify,
							setValue: 42,
						},
					],
				],
			]),
		);
		assert.deepEqual(deltas, expected);

		builder.setValue(root, 43);
		expected.push(
			new Map([
				[
					rootKey,
					[
						{
							type: Delta.MarkType.Modify,
							setValue: 43,
						},
					],
				],
			]),
		);
		assert.deepEqual(deltas, expected);

		builder.setValue(root, 44);
		expected.push(
			new Map([
				[
					rootKey,
					[
						{
							type: Delta.MarkType.Modify,
							setValue: 44,
						},
					],
				],
			]),
		);
		assert.deepEqual(deltas, expected);
	});
});
