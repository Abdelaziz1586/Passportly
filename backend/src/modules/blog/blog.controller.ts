import {
  Body,
  Controller,
  Delete,
  Get,
  NotImplementedException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { BlogService } from './blog.service';
import {
  BlogCommentItemDto,
  BlogPostDetailResponseDto,
  BlogPostItemDto,
  DeleteBlogPostResponseDto,
  PaginatedBlogPostsResponseDto,
} from './dto/blog-post-response.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { CreatePostDto } from './dto/create-post.dto';
import { ListMyPostsQueryDto } from './dto/list-my-posts-query.dto';
import { ListPostsQueryDto } from './dto/list-posts-query.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { OptionalJwtAuthGuard } from './guards/optional-jwt-auth.guard';

@ApiTags('Blog & Community')
@Controller()
export class BlogController {
  constructor(private readonly blogService: BlogService) {}

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Post('posts')
  @ApiOperation({ summary: 'BLG-01: Create blog post (Draft or Published)' })
  @ApiCreatedResponse({
    description: 'Blog post created successfully',
    type: BlogPostItemDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid blog post payload or tags',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Insufficient role permissions' })
  createPost(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePostDto,
  ): Promise<BlogPostItemDto> {
    return this.blogService.createPost(user.userId, dto);
  }

  @Public()
  @Get('posts')
  @ApiOperation({
    summary: 'BLG-02, BLG-09: List & search published blog posts',
  })
  @ApiOkResponse({
    description: 'Paginated published blog posts',
    type: PaginatedBlogPostsResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  listPosts(
    @Query() query: ListPostsQueryDto,
  ): Promise<PaginatedBlogPostsResponseDto> {
    return this.blogService.listPosts(query);
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Get('posts/mine')
  @ApiOperation({
    summary: 'BLG-03: List current user blog posts (including drafts)',
  })
  @ApiOkResponse({
    description: 'Paginated blog posts authored by current user',
    type: PaginatedBlogPostsResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Insufficient role permissions' })
  listMyPosts(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListMyPostsQueryDto,
  ): Promise<PaginatedBlogPostsResponseDto> {
    return this.blogService.listMyPosts(user.userId, query);
  }

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get('posts/:id')
  @ApiOperation({
    summary: 'BLG-02: Get published blog post details (or draft by author)',
  })
  @ApiParam({ name: 'id', description: 'Blog post MongoDB ObjectId' })
  @ApiOkResponse({
    description: 'Blog post details with author summary and visible comments',
    type: BlogPostDetailResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid blog post ID' })
  @ApiNotFoundResponse({
    description: 'Blog post not found or not accessible',
  })
  getPost(
    @Param('id') id: string,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<BlogPostDetailResponseDto> {
    return this.blogService.getPost(id, user);
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Patch('posts/:id')
  @ApiOperation({ summary: 'BLG-04, BLG-08: Update own blog post or tags' })
  @ApiParam({ name: 'id', description: 'Blog post MongoDB ObjectId' })
  @ApiOkResponse({
    description: 'Blog post updated successfully',
    type: BlogPostItemDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid post ID or update payload' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({
    description: 'Only the post author can update this blog post',
  })
  @ApiNotFoundResponse({ description: 'Blog post not found' })
  updatePost(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdatePostDto,
  ): Promise<BlogPostItemDto> {
    return this.blogService.updatePost(id, user.userId, dto);
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER, Role.ADMIN)
  @Delete('posts/:id')
  @ApiOperation({ summary: 'BLG-04: Delete blog post' })
  @ApiParam({ name: 'id', description: 'Blog post MongoDB ObjectId' })
  @ApiOkResponse({
    description: 'Blog post and related comments/likes deleted successfully',
    type: DeleteBlogPostResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid blog post ID' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({
    description:
      'Only the post author or an administrator can delete this post',
  })
  @ApiNotFoundResponse({ description: 'Blog post not found' })
  deletePost(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<DeleteBlogPostResponseDto> {
    return this.blogService.deletePost(id, user, req.ip);
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Post('posts/:id/comments')
  @ApiOperation({ summary: 'BLG-05: Add comment to a published post' })
  @ApiParam({ name: 'id', description: 'Published blog post MongoDB ObjectId' })
  @ApiCreatedResponse({
    description: 'Comment added to blog post successfully',
    type: BlogCommentItemDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid blog post ID or comment payload',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Insufficient role permissions' })
  @ApiNotFoundResponse({ description: 'Published blog post not found' })
  addComment(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCommentDto,
  ): Promise<BlogCommentItemDto> {
    return this.blogService.addComment(id, user.userId, dto);
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Patch('comments/:id')
  @ApiOperation({ summary: 'BLG-07: Update own comment' })
  @ApiParam({ name: 'id', description: 'Comment MongoDB ObjectId' })
  @ApiOkResponse({
    description: 'Comment updated successfully',
    type: BlogCommentItemDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid comment ID or comment payload',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({
    description: 'Only the comment author can update this comment',
  })
  @ApiNotFoundResponse({ description: 'Comment not found' })
  updateComment(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateCommentDto,
  ): Promise<BlogCommentItemDto> {
    return this.blogService.updateComment(id, user.userId, dto);
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
  getAuthorPage() {
    throw new NotImplementedException(
      'GET /api/authors/:id not implemented yet',
    );
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
