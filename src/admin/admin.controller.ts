import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import { CombinedAuthGuard } from '../auth/guards/combined-auth/combined-auth.guard';
import { OnlyAuthenticated } from '../auth/only-authenticated.decorator';
import { AdminService } from './admin.service';

/**
 * This controller provides some general administrative endpoints.
 */
@OnlyAuthenticated()
@UseGuards(CombinedAuthGuard)
@Controller('admin')
export class AdminController {
  constructor(private adminService: AdminService) {}

  @Post('/clear_local/:db')
  async clearLocal(@Param('db') db: string): Promise<any> {
    await this.adminService.clearLocal(db);
    return true;
  }
}
