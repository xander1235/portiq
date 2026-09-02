export interface EnvVar {
  key: string;
  value: string;
  comment: string;
  enabled: boolean;
  secret?: boolean;
}

export interface Environment {
  id: string;
  name: string;
  vars: EnvVar[];
}
