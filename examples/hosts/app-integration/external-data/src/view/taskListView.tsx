/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */
import { CollaborativeInput } from "@fluid-experimental/react-inputs";

import React, { useCallback, useEffect, useRef, useState } from "react";

import type { ExternalSnapshotTask, ITask, ITaskList } from "../model-interface";

interface ITaskRowProps {
	readonly task: ITask;
	readonly deleteDraftTask: () => void;
}

/**
 * The view for a single task in the TaskListView, as a table row.
 */
const TaskRow: React.FC<ITaskRowProps> = (props: ITaskRowProps) => {
	const { task, deleteDraftTask } = props;
	const priorityRef = useRef<HTMLInputElement>(null);
	const [externalDataSnapshot, setExternalDataSnapshot] = useState<ExternalSnapshotTask>(
		task.externalDataSnapshot,
	);
	const [showConflictUI, setShowConflictUI] = useState<boolean>(false);
	useEffect(() => {
		const updatePriorityFromFluid = (): void => {
			if (priorityRef.current !== null) {
				priorityRef.current.value = task.draftPriority.toString();
			}
		};
		const updateExternalSnapshotData = (conflictUIVisible: boolean): void => {
			setExternalDataSnapshot(task.externalDataSnapshot);
			setShowConflictUI(conflictUIVisible);
		};
		task.on("draftPriorityChanged", updatePriorityFromFluid);
		task.on("changesAvailable", updateExternalSnapshotData);
		updatePriorityFromFluid();
		return (): void => {
			task.off("draftPriorityChanged", updatePriorityFromFluid);
			task.off("changesAvailable", updateExternalSnapshotData);
		};
	}, [task, priorityRef]);

	const inputHandler = (e: React.FormEvent): void => {
		const newValue = Number.parseInt((e.target as HTMLInputElement).value, 10);
		task.draftPriority = newValue;
	};

	const showPriorityDiff =
		showConflictUI &&
		externalDataSnapshot.priority !== undefined &&
		externalDataSnapshot.priority !== task.draftPriority;
	const showNameDiff =
		showConflictUI &&
		externalDataSnapshot.name !== undefined &&
		externalDataSnapshot.name !== task.draftName.getText();
	const showAcceptButton = showConflictUI ? "visible" : "hidden";

	let diffColor: string = "white";
	switch (externalDataSnapshot.changeType) {
		case "add": {
			diffColor = "green";
			break;
		}
		case "delete": {
			diffColor = "red";
			break;
		}
		default: {
			diffColor = "orange";
			break;
		}
	}

	return (
		<tr>
			<td>{task.id}</td>
			<td>
				<CollaborativeInput
					sharedString={task.draftName}
					style={{ width: "200px" }}
				></CollaborativeInput>
			</td>
			<td>
				<input
					ref={priorityRef}
					onInput={inputHandler}
					type="number"
					style={{ width: "50px" }}
				></input>
			</td>
			<td>
				<button onClick={deleteDraftTask} style={{ background: "none", border: "none" }}>
					❌
				</button>
			</td>
			{showNameDiff && (
				<td style={{ backgroundColor: diffColor }}>{externalDataSnapshot.name}</td>
			)}
			{showPriorityDiff && (
				<td style={{ backgroundColor: diffColor, width: "30px" }}>
					{externalDataSnapshot.priority}
				</td>
			)}
			<td>
				<button
					onClick={task.overwriteWithExternalData}
					style={{ visibility: showAcceptButton }}
				>
					Accept change
				</button>
			</td>
		</tr>
	);
};

/**
 * {@link TaskListView} input props.
 */
export interface ITaskListViewProps {
	readonly taskList: ITaskList;
}

/**
 * A tabular, editable view of the task list.  Includes a save button to sync the changes back to the data source.
 */
export const TaskListView: React.FC<ITaskListViewProps> = (props: ITaskListViewProps) => {
	const { taskList } = props;

	const [tasks, setTasks] = useState<ITask[]>(taskList.getDraftTasks());
	const [lastSaved, setLastSaved] = useState<number | undefined>();
	const [failedUpdate, setFailedUpdate] = useState(false);
	const handleSaveChanges = useCallback(() => {
		taskList
			.writeToExternalServer()
			.then(() => {
				setLastSaved(Date.now());
				setFailedUpdate(false);
			})
			.catch((error) => {
				console.log(error);

				setFailedUpdate(true);
			});
	}, [taskList]);
	useEffect(() => {
		const updateTasks = (): void => {
			setTasks(taskList.getDraftTasks());
		};
		taskList.on("draftTaskAdded", updateTasks);
		taskList.on("draftTaskDeleted", updateTasks);

		return (): void => {
			taskList.off("draftTaskAdded", updateTasks);
			taskList.off("draftTaskDeleted", updateTasks);
		};
	}, [taskList]);

	const taskRows = tasks.map((task: ITask) => (
		<TaskRow
			key={task.id}
			task={task}
			deleteDraftTask={(): void => taskList.deleteDraftTask(task.id)}
		/>
	));

	return (
		// TODO: Gray button if not "authenticated" via debug controls
		// TODO: Conflict UI
		<div>
			<h2 style={{ textDecoration: "underline" }}>Client App</h2>
			{lastSaved !== undefined && !failedUpdate && (
				<h4
					style={{
						display: "inline-block",
						backgroundColor: "#a4c995",
						padding: "5px",
						fontWeight: "normal",
					}}
				>
					Last successful save:{" "}
					{new Date(lastSaved).toLocaleString("en-US", {
						hour: "numeric",
						minute: "numeric",
						second: "numeric",
					})}
				</h4>
			)}
			{failedUpdate && (
				<h4
					style={{
						display: "inline-block",
						backgroundColor: "#ff9b9b",
						padding: "5px",
						fontWeight: "normal",
					}}
				>
					Push To External Service failed. Try again.
				</h4>
			)}

			<table>
				<thead>
					<tr>
						<td>ID</td>
						<td>Title</td>
						<td>Priority</td>
					</tr>
				</thead>
				<tbody>{taskRows}</tbody>
			</table>
			<button onClick={handleSaveChanges}>Write to External Source</button>
		</div>
	);
};
