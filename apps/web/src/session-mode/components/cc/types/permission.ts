export type CanUseToolCallback = (
  toolName: string,
  input: any,
  context: ToolPermissionContext
) => Promise<PermissionResult>;

export interface ToolPermissionContext {
  signal?: null;
  suggestions: PermissionUpdate[];
  toolUseId?: string;
}

export type PermissionResult =
  | ({ behavior: 'allow' } & PermissionResultAllow)
  | ({ behavior: 'deny' } & PermissionResultDeny);

export interface PermissionResultAllow {
  updatedInput: any | null;
  updatedPermissions?: PermissionUpdate[];
}

export interface PermissionResultDeny {
  message: string;
  interrupt: boolean;
}

export interface PermissionUpdate {
  type: PermissionUpdateType;
  rules?: PermissionRuleValue[];
  behavior?: PermissionBehavior;
  mode?: string;
  directories?: string[];
  destination?: PermissionUpdateDestination;
}

export type PermissionUpdateType =
  | 'addRules'
  | 'replaceRules'
  | 'removeRules'
  | 'setMode'
  | 'addDirectories'
  | 'removeDirectories';

export interface PermissionRuleValue {
  toolName: string;
  ruleContent?: string;
}

export type PermissionBehavior = 'allow' | 'deny' | 'ask';
export type PermissionDecision = 'allow' | 'allow_always' | 'allow_project' | 'deny';

export type PermissionUpdateDestination =
  | 'userSettings'
  | 'projectSettings'
  | 'localSettings'
  | 'session';
