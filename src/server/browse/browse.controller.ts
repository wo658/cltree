/**
 * Browse controller — basic browse CLI endpoint
 *
 * The reverse proxy is mounted directly in main.ts via http-proxy-middleware.
 * This controller handles only browse-related REST API endpoints.
 */
import { Controller } from '@nestjs/common';

@Controller('api/browse')
export class BrowseController {}
