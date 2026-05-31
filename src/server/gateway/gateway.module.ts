/**
 * WebSocket Gateway module
 *
 * Broadcasts PTY I/O streaming + state change events over WebSocket.
 */
import { Module } from '@nestjs/common';
import { PaneModule } from '../pane/pane.module';
import { SessionModule } from '../session/session.module';
import { PtyGateway } from './pty.gateway';

@Module({
  imports: [PaneModule, SessionModule],
  providers: [PtyGateway],
  exports: [PtyGateway],
})
export class GatewayModule {}
