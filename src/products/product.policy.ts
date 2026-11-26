import { Policy } from '@nestjs/authorization';
import type { User } from '../users/user.js';

@Policy()
export class ProductPolicy {
  // `null` is a guest.
  manage(user: User | null) {
    return user?.role === 'staff';
  }
}
