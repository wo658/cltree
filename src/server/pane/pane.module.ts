import { Module, forwardRef } from '@nestjs/common';
import { PaneService } from './pane.service';
import { PaneController } from './pane.controller';
import { PtyManagerService } from './pty-manager.service';
import { SessionModule } from '../session/session.module';
import { RepoModule } from '../repo/repo.module';

@Module({
  imports: [forwardRef(() => SessionModule), RepoModule],
  providers: [PaneService, PtyManagerService],
  controllers: [PaneController],
  exports: [PaneService, PtyManagerService],
})
export class PaneModule {}
