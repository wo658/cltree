/**
 * Config module
 *
 * Registered as a global module so that ConfigService can be injected in any module.
 */
import { Global, Module } from '@nestjs/common';
import { ConfigService } from './config.service';

@Global()
@Module({
  providers: [ConfigService],
  exports: [ConfigService],
})
export class ConfigModule {}
