/**
 * Browse module — browser automation + reverse proxy
 */
import { Module } from '@nestjs/common';
import { BrowseController } from './browse.controller';
import { BrowseService } from './browse.service';

@Module({
  controllers: [BrowseController],
  providers: [BrowseService],
  exports: [BrowseService],
})
export class BrowseModule {}
