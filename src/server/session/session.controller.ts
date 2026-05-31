import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  HttpCode,
} from '@nestjs/common';
import { SessionService } from './session.service';

/**
 * Session HTTP endpoints.
 * The CLI router calls service methods directly,
 * but this controller also exposes them via REST API.
 */
@Controller('api/sessions')
export class SessionController {
  constructor(private readonly sessionService: SessionService) {}

  /** Session list (tree structure) */
  @Get()
  list() {
    return { sessions: this.sessionService.list() };
  }

  /** Fetch session details */
  @Get(':id')
  inspect(@Param('id') id: string) {
    return this.sessionService.inspect(id);
  }

  /** Create a session */
  @Post()
  create(
    @Body()
    body: {
      name: string;
      repo?: string;
      cwd?: string;
      parentSessionId?: string;
      issueNumber?: number;
    },
  ) {
    const session = this.sessionService.create(body);
    return { session };
  }

  /** Switch to a session */
  @Post(':id/switch')
  @HttpCode(200)
  switchTo(@Param('id') id: string) {
    this.sessionService.switchTo(id);
    return { switched: id };
  }

  /** Delete a session */
  @Delete(':id')
  delete(@Param('id') id: string) {
    this.sessionService.delete(id);
    return { deleted: id };
  }

  /** Rename a session */
  @Post(':id/rename')
  @HttpCode(200)
  rename(@Param('id') id: string, @Body('name') name: string) {
    const session = this.sessionService.rename(id, name);
    return { session: { id: session.id, name: session.name } };
  }

  /** Complete a session */
  @Post(':id/complete')
  @HttpCode(200)
  complete(@Param('id') id: string) {
    const session = this.sessionService.complete(id);
    return { session: { id: session.id, name: session.name, status: session.status }, pr: null };
  }

  /** Archive a session */
  @Post(':id/archive')
  @HttpCode(200)
  archive(@Param('id') id: string) {
    const session = this.sessionService.archive(id);
    return { session: { id: session.id, name: session.name, status: session.status } };
  }
}
