export interface AppVariables {
  user: {
    id: number;
    role: string;
  };
  keyRecord: {
    id: number;
    userId: number;
    apiKey: string;
    name: string;
    enabled: boolean;
    deletedAt: Date | null;
    createdAt: Date;
  };
}
