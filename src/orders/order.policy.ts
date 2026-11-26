import { Policy } from '@nestjs/authorization';
import type { User } from '../users/user.js';

@Policy()
export class OrderPolicy {
  ship(user: User | null) {
    return user?.role === 'staff';
  }
}
