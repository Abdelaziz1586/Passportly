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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
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
  AuthorProfileResponseDto,
  BlogCommentItemDto,
  BlogPostDetailResponseDto,
  BlogPostItemDto,
  DeleteBlogPostResponseDto,
  DeleteCommentResponseDto,
  DeletePostImageResponseDto,
  PaginatedBlogPostsResponseDto,
  PostLikeResponseDto,
  TagPostsResponseDto,
  UploadPostImageResponseDto,
} from './dto/blog-post-response.dto';
import { AuthorPostsQueryDto } from './dto/author-posts-query.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { CreatePostDto } from './dto/create-post.dto';
import { ListMyPostsQueryDto } from './dto/list-my-posts-query.dto';
import { ListPostsByTagQueryDto } from './dto/list-posts-by-tag-query.dto';
import { ListPostsQueryDto } from './dto/list-posts-query.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { OptionalJwtAuthGuard } from './guards/optional-jwt-auth.guard';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

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
  @ApiParam({ name: 'id', description: 'Comment MongoDB ObjectId' })
  @ApiOkResponse({
    description: 'Comment deleted and post comment count updated',
    type: DeleteCommentResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid comment ID' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({
    description:
      'Only the comment author or an administrator can delete this comment',
  })
  @ApiNotFoundResponse({ description: 'Comment not found' })
  deleteComment(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<DeleteCommentResponseDto> {
    return this.blogService.deleteComment(id, user, req.ip);
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Post('posts/:id/like')
  @ApiOperation({ summary: 'BLG-06: Like a post (at most once per user)' })
  @ApiParam({ name: 'id', description: 'Published blog post MongoDB ObjectId' })
  @ApiCreatedResponse({
    description: 'Post liked successfully',
    type: PostLikeResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid blog post ID' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Insufficient role permissions' })
  @ApiNotFoundResponse({ description: 'Published blog post not found' })
  @ApiConflictResponse({ description: 'User has already liked this post' })
  likePost(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PostLikeResponseDto> {
    return this.blogService.likePost(id, user.userId);
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Delete('posts/:id/like')
  @ApiOperation({ summary: 'BLG-06: Unlike a post' })
  @ApiParam({ name: 'id', description: 'Blog post MongoDB ObjectId' })
  @ApiOkResponse({
    description: 'Like removed if present and likesCount returned',
    type: PostLikeResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid blog post ID' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Insufficient role permissions' })
  @ApiNotFoundResponse({ description: 'Blog post not found' })
  unlikePost(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PostLikeResponseDto> {
    return this.blogService.unlikePost(id, user.userId);
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { files: 1, fileSize: MAX_UPLOAD_BYTES },
    }),
  )
  @Post('posts/:id/images')
  @ApiOperation({ summary: 'BLG-10, GEN-08: Upload image to blog post' })
  @ApiParam({ name: 'id', description: 'Blog post MongoDB ObjectId' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['image'],
      properties: {
        image: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiCreatedResponse({
    description: 'Image validated, stored, and attached to blog post',
    type: UploadPostImageResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid post ID or invalid/oversized image file',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({
    description: 'Only the post author can upload images to this blog post',
  })
  @ApiNotFoundResponse({ description: 'Blog post not found' })
  uploadPostImage(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<UploadPostImageResponseDto> {
    return this.blogService.uploadPostImage(id, user.userId, file);
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Delete('posts/:id/images/:imageId')
  @ApiOperation({ summary: 'BLG-10: Delete image from blog post' })
  @ApiParam({ name: 'id', description: 'Blog post MongoDB ObjectId' })
  @ApiParam({ name: 'imageId', description: 'MediaItem MongoDB ObjectId' })
  @ApiOkResponse({
    description: 'Image removed from blog post successfully',
    type: DeletePostImageResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid post ID or image ID' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({
    description: 'Only the post author can delete images from this blog post',
  })
  @ApiNotFoundResponse({ description: 'Blog post or image not found' })
  deletePostImage(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DeletePostImageResponseDto> {
    return this.blogService.deletePostImage(id, imageId, user.userId);
  }

  @Public()
  @Get('tags/:tag/posts')
  @ApiOperation({ summary: 'BLG-08: List published blog posts by tag' })
  @ApiParam({ name: 'tag', description: 'Tag name or normalized slug' })
  @ApiOkResponse({
    description: 'Paginated published blog posts matching the tag',
    type: TagPostsResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid tag or query parameters' })
  getPostsByTag(
    @Param('tag') tag: string,
    @Query() query: ListPostsByTagQueryDto,
  ): Promise<TagPostsResponseDto> {
    return this.blogService.getPostsByTag(tag, query);
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
