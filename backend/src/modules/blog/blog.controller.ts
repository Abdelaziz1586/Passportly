import {
  Controller,
  Delete,
  Get,
  NotImplementedException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums';
import { BlogService } from './blog.service';
import { AuthorPostsQueryDto } from './dto/author-posts-query.dto';
import { AuthorProfileResponseDto } from './dto/blog-post-response.dto';

@ApiTags('Blog & Community')
@Controller()
export class BlogController {
  constructor(private readonly blogService: BlogService) {}

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Post('posts')
  @ApiOperation({ summary: 'BLG-01: Create blog post (Draft or Published)' })
  createPost() {
    throw new NotImplementedException('POST /api/posts not implemented yet');
  }

  @Public()
  @Get('posts')
  @ApiOperation({
    summary: 'BLG-02, BLG-09: List & search published blog posts',
  })
  listPosts() {
    throw new NotImplementedException('GET /api/posts not implemented yet');
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Get('posts/mine')
  @ApiOperation({
    summary: 'BLG-03: List current user blog posts (including drafts)',
  })
  listMyPosts() {
    throw new NotImplementedException(
      'GET /api/posts/mine not implemented yet',
    );
  }

  @Public()
  @Get('posts/:id')
  @ApiOperation({ summary: 'BLG-02: Get published blog post details' })
  getPost() {
    throw new NotImplementedException('GET /api/posts/:id not implemented yet');
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Patch('posts/:id')
  @ApiOperation({ summary: 'BLG-04, BLG-08: Update own blog post or tags' })
  updatePost() {
    throw new NotImplementedException(
      'PATCH /api/posts/:id not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER, Role.ADMIN)
  @Delete('posts/:id')
  @ApiOperation({ summary: 'BLG-04: Delete blog post' })
  deletePost() {
    throw new NotImplementedException(
      'DELETE /api/posts/:id not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Post('posts/:id/comments')
  @ApiOperation({ summary: 'BLG-05: Add comment to a published post' })
  addComment() {
    throw new NotImplementedException(
      'POST /api/posts/:id/comments not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Patch('comments/:id')
  @ApiOperation({ summary: 'BLG-07: Update own comment' })
  updateComment() {
    throw new NotImplementedException(
      'PATCH /api/comments/:id not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER, Role.ADMIN)
  @Delete('comments/:id')
  @ApiOperation({ summary: 'BLG-07: Delete comment' })
  deleteComment() {
    throw new NotImplementedException(
      'DELETE /api/comments/:id not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Post('posts/:id/like')
  @ApiOperation({ summary: 'BLG-06: Like a post (at most once per user)' })
  likePost() {
    throw new NotImplementedException(
      'POST /api/posts/:id/like not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Delete('posts/:id/like')
  @ApiOperation({ summary: 'BLG-06: Unlike a post' })
  unlikePost() {
    throw new NotImplementedException(
      'DELETE /api/posts/:id/like not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Post('posts/:id/images')
  @ApiOperation({ summary: 'BLG-10, GEN-08: Upload image to blog post' })
  uploadPostImage() {
    throw new NotImplementedException(
      'POST /api/posts/:id/images not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Delete('posts/:id/images/:imageId')
  @ApiOperation({ summary: 'BLG-10: Delete image from blog post' })
  deletePostImage() {
    throw new NotImplementedException(
      'DELETE /api/posts/:id/images/:imageId not implemented yet',
    );
  }

  @Public()
  @Get('tags/:tag/posts')
  @ApiOperation({ summary: 'BLG-08: List published blog posts by tag' })
  getPostsByTag() {
    throw new NotImplementedException(
      'GET /api/tags/:tag/posts not implemented yet',
    );
  }

  @Public()
  @Get('authors/:id')
  @ApiOperation({
    summary: 'BLG-12: View public author profile and published posts',
  })
  @ApiParam({ name: 'id', description: 'Author user MongoDB ObjectId' })
  @ApiOkResponse({
    description: 'Safe public author profile and paginated published posts',
    type: AuthorProfileResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid author ID or query params' })
  @ApiNotFoundResponse({ description: 'Author not found' })
  getAuthorPage(
    @Param('id') id: string,
    @Query() query: AuthorPostsQueryDto,
  ): Promise<AuthorProfileResponseDto> {
    return this.blogService.getAuthorPage(id, query);
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Patch('posts/:id/itinerary')
  @ApiOperation({ summary: 'BLG-13 (Optional): Attach itinerary to blog post' })
  attachItinerary() {
    throw new NotImplementedException(
      'PATCH /api/posts/:id/itinerary not implemented yet',
    );
  }
}
