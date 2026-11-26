export type Role = 'customer' | 'staff';

export interface User {
  id: string;
  email: string;
  role: Role;
  createdAt: Date;
}
