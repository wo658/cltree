/**
 * CLI module
 *
 * Routes all CLI commands through the single POST /api/cli endpoint.
 */
import { Module } from '@nestjs/common';
import { SessionModule } from '../session/session.module';
import { PaneModule } from '../pane/pane.module';
import { RepoModule } from '../repo/repo.module';
import { BrowseModule } from '../browse/browse.module';
import { CliController } from './cli.controller';

@Module({
  imports: [SessionModule, PaneModule, RepoModule, BrowseModule],
  controllers: [CliController],
})
export class CliModule {}
