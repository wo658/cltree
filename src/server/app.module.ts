/**
 * Root application module
 *
 * Integrates all feature modules.
 * Serves the built web frontend statically via ServeStaticModule.
 */
import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { join } from 'path';
import { ConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { SessionModule } from './session/session.module';
import { PaneModule } from './pane/pane.module';
import { GatewayModule } from './gateway/gateway.module';
import { CliModule } from './cli/cli.module';
import { RepoModule } from './repo/repo.module';
import { BrowseModule } from './browse/browse.module';

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '..', '..', 'dist', 'web'),
    }),
    ConfigModule,
    DbModule,
    SessionModule,
    PaneModule,
    RepoModule,
    BrowseModule,
    GatewayModule,
    CliModule,
  ],
})
export class AppModule {}
