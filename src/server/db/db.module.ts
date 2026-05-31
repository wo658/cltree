/**
 * Database module
 *
 * Registered as a global module so that DbService can be injected in any module.
 */
import { Global, Module } from '@nestjs/common';
import { DbService } from './db.service';

@Global()
@Module({
  providers: [DbService],
  exports: [DbService],
})
export class DbModule {}
