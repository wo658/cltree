import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { PaneService } from './pane.service';

/**
 * Pane HTTP endpoints.
 * The CLI router calls the service directly, but REST API access is also supported.
 */
@Controller('api/panes')
export class PaneController {
  constructor(private readonly paneService: PaneService) {}

  /** Pane list (per session) */
  @Get()
  list(@Query('sessionId') sessionId: string) {
    return this.paneService.list(sessionId);
  }

  /** Create an agent pane */
  @Post('spawn')
  spawn(@Body() body: { sessionId: string; cmd?: string }) {
    const pane = this.paneService.spawn(body);
    return { pane };
  }

  /** Create a terminal pane */
  @Post('attach')
  attach(@Body() body: { sessionId: string; cmd?: string }) {
    const pane = this.paneService.attach(body);
    return { pane };
  }

  /** Kill a pane */
  @Delete(':id')
  kill(@Param('id') id: string) {
    this.paneService.kill(id);
    return { killed: id };
  }

}
