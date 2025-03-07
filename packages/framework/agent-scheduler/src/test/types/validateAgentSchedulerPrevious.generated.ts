/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */
/*
 * THIS IS AN AUTOGENERATED FILE. DO NOT EDIT THIS FILE DIRECTLY.
 * Generated by fluid-type-test-generator in @fluidframework/build-tools.
 */
import * as old from "@fluidframework/agent-scheduler-previous";
import * as current from "../../index";

type TypeOnly<T> = {
    [P in keyof T]: TypeOnly<T[P]>;
};

/*
* Validate forward compat by using old type in place of current type
* If breaking change required, add in package.json under typeValidation.broken:
* "ClassDeclaration_AgentSchedulerFactory": {"forwardCompat": false}
*/
declare function get_old_ClassDeclaration_AgentSchedulerFactory():
    TypeOnly<old.AgentSchedulerFactory>;
declare function use_current_ClassDeclaration_AgentSchedulerFactory(
    use: TypeOnly<current.AgentSchedulerFactory>);
use_current_ClassDeclaration_AgentSchedulerFactory(
    get_old_ClassDeclaration_AgentSchedulerFactory());

/*
* Validate back compat by using current type in place of old type
* If breaking change required, add in package.json under typeValidation.broken:
* "ClassDeclaration_AgentSchedulerFactory": {"backCompat": false}
*/
declare function get_current_ClassDeclaration_AgentSchedulerFactory():
    TypeOnly<current.AgentSchedulerFactory>;
declare function use_old_ClassDeclaration_AgentSchedulerFactory(
    use: TypeOnly<old.AgentSchedulerFactory>);
use_old_ClassDeclaration_AgentSchedulerFactory(
    get_current_ClassDeclaration_AgentSchedulerFactory());

/*
* Validate forward compat by using old type in place of current type
* If breaking change required, add in package.json under typeValidation.broken:
* "VariableDeclaration_IAgentScheduler": {"forwardCompat": false}
*/
declare function get_old_VariableDeclaration_IAgentScheduler():
    TypeOnly<typeof old.IAgentScheduler>;
declare function use_current_VariableDeclaration_IAgentScheduler(
    use: TypeOnly<typeof current.IAgentScheduler>);
use_current_VariableDeclaration_IAgentScheduler(
    get_old_VariableDeclaration_IAgentScheduler());

/*
* Validate back compat by using current type in place of old type
* If breaking change required, add in package.json under typeValidation.broken:
* "VariableDeclaration_IAgentScheduler": {"backCompat": false}
*/
declare function get_current_VariableDeclaration_IAgentScheduler():
    TypeOnly<typeof current.IAgentScheduler>;
declare function use_old_VariableDeclaration_IAgentScheduler(
    use: TypeOnly<typeof old.IAgentScheduler>);
use_old_VariableDeclaration_IAgentScheduler(
    get_current_VariableDeclaration_IAgentScheduler());

/*
* Validate forward compat by using old type in place of current type
* If breaking change required, add in package.json under typeValidation.broken:
* "InterfaceDeclaration_IAgentScheduler": {"forwardCompat": false}
*/
declare function get_old_InterfaceDeclaration_IAgentScheduler():
    TypeOnly<old.IAgentScheduler>;
declare function use_current_InterfaceDeclaration_IAgentScheduler(
    use: TypeOnly<current.IAgentScheduler>);
use_current_InterfaceDeclaration_IAgentScheduler(
    get_old_InterfaceDeclaration_IAgentScheduler());

/*
* Validate back compat by using current type in place of old type
* If breaking change required, add in package.json under typeValidation.broken:
* "InterfaceDeclaration_IAgentScheduler": {"backCompat": false}
*/
declare function get_current_InterfaceDeclaration_IAgentScheduler():
    TypeOnly<current.IAgentScheduler>;
declare function use_old_InterfaceDeclaration_IAgentScheduler(
    use: TypeOnly<old.IAgentScheduler>);
use_old_InterfaceDeclaration_IAgentScheduler(
    get_current_InterfaceDeclaration_IAgentScheduler());

/*
* Validate forward compat by using old type in place of current type
* If breaking change required, add in package.json under typeValidation.broken:
* "InterfaceDeclaration_IAgentSchedulerEvents": {"forwardCompat": false}
*/
declare function get_old_InterfaceDeclaration_IAgentSchedulerEvents():
    TypeOnly<old.IAgentSchedulerEvents>;
declare function use_current_InterfaceDeclaration_IAgentSchedulerEvents(
    use: TypeOnly<current.IAgentSchedulerEvents>);
use_current_InterfaceDeclaration_IAgentSchedulerEvents(
    get_old_InterfaceDeclaration_IAgentSchedulerEvents());

/*
* Validate back compat by using current type in place of old type
* If breaking change required, add in package.json under typeValidation.broken:
* "InterfaceDeclaration_IAgentSchedulerEvents": {"backCompat": false}
*/
declare function get_current_InterfaceDeclaration_IAgentSchedulerEvents():
    TypeOnly<current.IAgentSchedulerEvents>;
declare function use_old_InterfaceDeclaration_IAgentSchedulerEvents(
    use: TypeOnly<old.IAgentSchedulerEvents>);
use_old_InterfaceDeclaration_IAgentSchedulerEvents(
    get_current_InterfaceDeclaration_IAgentSchedulerEvents());

/*
* Validate forward compat by using old type in place of current type
* If breaking change required, add in package.json under typeValidation.broken:
* "InterfaceDeclaration_IProvideAgentScheduler": {"forwardCompat": false}
*/
declare function get_old_InterfaceDeclaration_IProvideAgentScheduler():
    TypeOnly<old.IProvideAgentScheduler>;
declare function use_current_InterfaceDeclaration_IProvideAgentScheduler(
    use: TypeOnly<current.IProvideAgentScheduler>);
use_current_InterfaceDeclaration_IProvideAgentScheduler(
    get_old_InterfaceDeclaration_IProvideAgentScheduler());

/*
* Validate back compat by using current type in place of old type
* If breaking change required, add in package.json under typeValidation.broken:
* "InterfaceDeclaration_IProvideAgentScheduler": {"backCompat": false}
*/
declare function get_current_InterfaceDeclaration_IProvideAgentScheduler():
    TypeOnly<current.IProvideAgentScheduler>;
declare function use_old_InterfaceDeclaration_IProvideAgentScheduler(
    use: TypeOnly<old.IProvideAgentScheduler>);
use_old_InterfaceDeclaration_IProvideAgentScheduler(
    get_current_InterfaceDeclaration_IProvideAgentScheduler());

/*
* Validate forward compat by using old type in place of current type
* If breaking change required, add in package.json under typeValidation.broken:
* "InterfaceDeclaration_ITaskSubscriptionEvents": {"forwardCompat": false}
*/
declare function get_old_InterfaceDeclaration_ITaskSubscriptionEvents():
    TypeOnly<old.ITaskSubscriptionEvents>;
declare function use_current_InterfaceDeclaration_ITaskSubscriptionEvents(
    use: TypeOnly<current.ITaskSubscriptionEvents>);
use_current_InterfaceDeclaration_ITaskSubscriptionEvents(
    get_old_InterfaceDeclaration_ITaskSubscriptionEvents());

/*
* Validate back compat by using current type in place of old type
* If breaking change required, add in package.json under typeValidation.broken:
* "InterfaceDeclaration_ITaskSubscriptionEvents": {"backCompat": false}
*/
declare function get_current_InterfaceDeclaration_ITaskSubscriptionEvents():
    TypeOnly<current.ITaskSubscriptionEvents>;
declare function use_old_InterfaceDeclaration_ITaskSubscriptionEvents(
    use: TypeOnly<old.ITaskSubscriptionEvents>);
use_old_InterfaceDeclaration_ITaskSubscriptionEvents(
    get_current_InterfaceDeclaration_ITaskSubscriptionEvents());

/*
* Validate forward compat by using old type in place of current type
* If breaking change required, add in package.json under typeValidation.broken:
* "ClassDeclaration_TaskSubscription": {"forwardCompat": false}
*/
declare function get_old_ClassDeclaration_TaskSubscription():
    TypeOnly<old.TaskSubscription>;
declare function use_current_ClassDeclaration_TaskSubscription(
    use: TypeOnly<current.TaskSubscription>);
use_current_ClassDeclaration_TaskSubscription(
    get_old_ClassDeclaration_TaskSubscription());

/*
* Validate back compat by using current type in place of old type
* If breaking change required, add in package.json under typeValidation.broken:
* "ClassDeclaration_TaskSubscription": {"backCompat": false}
*/
declare function get_current_ClassDeclaration_TaskSubscription():
    TypeOnly<current.TaskSubscription>;
declare function use_old_ClassDeclaration_TaskSubscription(
    use: TypeOnly<old.TaskSubscription>);
use_old_ClassDeclaration_TaskSubscription(
    get_current_ClassDeclaration_TaskSubscription());
