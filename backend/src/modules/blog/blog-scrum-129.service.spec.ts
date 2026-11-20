import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { UploadsService } from '../uploads/uploads.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { BlogService } from './blog.service';
import { BlogPost } from './schemas/blog-post.schema';
import { Comment } from './schemas/comment.schema';
import { Like } from './schemas/like.schema';
import { Tag } from './schemas/tag.schema';

describe('BlogService (SCRUM-129 BLG-10 delete post image)', () => {
  let service: BlogService;

  const mockBlogPostModel = {
    findById: jest.fn(),
    findOneAndUpdate: jest.fn(),
  };
  const mockUploadsService = {
    deleteImage: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockUploadsService.deleteImage.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BlogService,
        { provide: getModelToken(BlogPost.name), useValue: mockBlogPostModel },
        { provide: getModelToken(Comment.name), useValue: {} },
        { provide: getModelToken(Like.name), useValue: {} },
        { provide: AuditLogsService, useValue: { log: jest.fn() } },
        { provide: NotificationsService, useValue: { createNotification: jest.fn() } },
        { provide: getModelToken(Tag.name), useValue: {} },
        { provide: UploadsService, useValue: mockUploadsService },
      ],
    }).compile();

    service = module.get<BlogService>(BlogService);
  });

  it('removes MediaItem matching imageId and deletes stored file for post author', async () => {
    const postId = new Types.ObjectId();
    const authorId = new Types.ObjectId();
    const imageId = new Types.ObjectId();

    mockBlogPostModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: postId,
        author: authorId,
        images: [
          {
            _id: imageId,
            url: '/uploads/blog-posts/target.png',
            filename: 'target.png',
            mimeType: 'image/png',
            sizeBytes: 120,
            uploadedAt: new Date(),
          },
        ],
      }),
    });
    mockBlogPostModel.findOneAndUpdate.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: postId,
        images: [],
      }),
    });

    const result = await service.deletePostImage(
      postId.toHexString(),
      imageId.toHexString(),
      authorId.toHexString(),
    );

    expect(mockBlogPostModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: postId, author: authorId },
      { $pull: { images: { _id: imageId } } },
      { returnDocument: 'after' },
    );
    expect(mockUploadsService.deleteImage).toHaveBeenCalledWith(
      '/uploads/blog-posts/target.png',
    );
    expect(result).toEqual({
      message: 'Image deleted successfully',
      postId: postId.toHexString(),
      imageId: imageId.toHexString(),
      images: [],
    });
  });

  it('throws ForbiddenException when requester is not the post author', async () => {
    const postId = new Types.ObjectId();
    const imageId = new Types.ObjectId();

    mockBlogPostModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: postId,
        author: new Types.ObjectId(),
        images: [{ _id: imageId, url: '/uploads/blog-posts/a.png' }],
      }),
    });

    await expect(
      service.deletePostImage(
        postId.toHexString(),
        imageId.toHexString(),
        new Types.ObjectId().toHexString(),
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(mockBlogPostModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when post or imageId is missing, and BadRequestException for invalid IDs', async () => {
    await expect(
      service.deletePostImage(
        'bad-post',
        new Types.ObjectId().toHexString(),
        new Types.ObjectId().toHexString(),
      ),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.deletePostImage(
        new Types.ObjectId().toHexString(),
        'bad-image',
        new Types.ObjectId().toHexString(),
      ),
    ).rejects.toThrow(BadRequestException);

    const postId = new Types.ObjectId();
    const authorId = new Types.ObjectId();
    mockBlogPostModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: postId,
        author: authorId,
        images: [],
      }),
    });

    await expect(
      service.deletePostImage(
        postId.toHexString(),
        new Types.ObjectId().toHexString(),
        authorId.toHexString(),
      ),
    ).rejects.toThrow(NotFoundException);
  });
});
