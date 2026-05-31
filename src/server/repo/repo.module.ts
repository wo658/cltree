import { Module } from '@nestjs/common';
import { RepoService } from './repo.service';

@Module({
  providers: [RepoService],
  exports: [RepoService],
})
export class RepoModule {}
