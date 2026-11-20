import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { NotificationType, Role } from '../../common/enums';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UploadsService } from '../uploads/uploads.service';
import { BlogService } from './blog.service';
import { BlogPost } from './schemas/blog-post.schema';
import { Comment } from './schemas/comment.schema';
import { Like } from './schemas/like.schema';
import { Tag } from './schemas/tag.schema';

describe('BlogService (SCRUM-122 BLG-04 delete post)', () => {
  let service: BlogService;

  const mockBlogPostModel = {
    findById: jest.fn(),
    findByIdAndDelete: jest.fn(),
  };
  const mockCommentModel = {
    deleteMany: jest.fn(),
  };
  const mockLikeModel = {
    deleteMany: jest.fn(),
  };
  const mockTagModel = {
    updateMany: jest.fn(),
  };
  const mockUploadsService = {
    deleteImage: jest.fn(),
  };
  const mockAuditLogsService = {
    log: jest.fn(),
  };
  const mockNotificationsService = {
    createNotification: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCommentModel.deleteMany.mockResolvedValue({ deletedCount: 2 });
    mockLikeModel.deleteMany.mockResolvedValue({ deletedCount: 3 });
    mockTagModel.updateMany.mockResolvedValue({ modifiedCount: 2 });
    mockUploadsService.deleteImage.mockResolvedValue(undefined);
    mockAuditLogsService.log.mockResolvedValue({});
    mockNotificationsService.createNotification.mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BlogService,
        { provide: getModelToken(BlogPost.name), useValue: mockBlogPostModel },
        { provide: getModelToken(Comment.name), useValue: mockCommentModel },
        { provide: getModelToken(Like.name), useValue: mockLikeModel },
        { provide: getModelToken(Tag.name), useValue: mockTagModel },
        { provide: UploadsService, useValue: mockUploadsService },
        { provide: AuditLogsService, useValue: mockAuditLogsService },
        { provide: NotificationsService, useValue: mockNotificationsService },
      ],
    }).compile();

    service = module.get<BlogService>(BlogService);
  });

  it('allows author to delete post and cascades comments, likes, tag usageCounts, and images', async () => {
    const authorId = new Types.ObjectId();
    const postId = new Types.ObjectId();
    const tagId = new Types.ObjectId();

    const postDoc = {
      _id: postId,
      author: authorId,
      title: 'Cairo Guide',
      tags: ['egypt'],
      tagRefs: [tagId],
      images: [{ url: '/uploads/blog-posts/img1.jpg' }],
    };

    mockBlogPostModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue(postDoc),
    });
    mockBlogPostModel.findByIdAndDelete.mockReturnValue({
      lean: jest.fn().mockResolvedValue(postDoc),
    });

    const result = await service.deletePost(postId.toHexString(), {
      userId: authorId.toHexString(),
      email: 'abdullah@example.com',
      role: Role.REGISTERED_USER,
      jti: 'jti-1',
    });

    expect(result).toEqual({
      message: 'Blog post deleted successfully',
      id: postId.toHexString(),
    });
    expect(mockCommentModel.deleteMany).toHaveBeenCalledWith({ post: postId });
    expect(mockLikeModel.deleteMany).toHaveBeenCalledWith({ post: postId });
    expect(mockTagModel.updateMany).toHaveBeenCalledWith(
      { _id: { $in: [tagId] }, usageCount: { $gt: 0 } },
      { $inc: { usageCount: -1 } },
    );
    expect(mockUploadsService.deleteImage).toHaveBeenCalledWith(
      '/uploads/blog-posts/img1.jpg',
    );
    expect(mockAuditLogsService.log).not.toHaveBeenCalled();
  });

  it('allows ADMIN to delete another user post and records audit log + notification', async () => {
    const authorId = new Types.ObjectId();
    const adminId = new Types.ObjectId();
    const postId = new Types.ObjectId();

    const postDoc = {
      _id: postId,
      author: authorId,
      title: 'Spam Post',
      tags: ['spam'],
      tagRefs: [],
      images: [],
    };

    mockBlogPostModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue(postDoc),
    });
    mockBlogPostModel.findByIdAndDelete.mockReturnValue({
      lean: jest.fn().mockResolvedValue(postDoc),
    });

    await service.deletePost(
      postId.toHexString(),
      {
        userId: adminId.toHexString(),
        email: 'admin@example.com',
        role: Role.ADMIN,
        jti: 'jti-admin',
      },
      '127.0.0.1',
    );

    expect(mockTagModel.updateMany).toHaveBeenCalledWith(
      { slug: { $in: ['spam'] }, usageCount: { $gt: 0 } },
      { $inc: { usageCount: -1 } },
    );
    expect(mockNotificationsService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: authorId,
        type: NotificationType.MODERATION_ACTION,
      }),
    );
    expect(mockAuditLogsService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: adminId.toHexString(),
        action: 'CONTENT_DELETED',
        targetType: 'BlogPost',
      }),
    );
  });

  it('throws ForbiddenException when a non-author non-admin tries to delete the post', async () => {
    const postId = new Types.ObjectId();
    mockBlogPostModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: postId,
        author: new Types.ObjectId(),
      }),
    });

    await expect(
      service.deletePost(postId.toHexString(), {
        userId: new Types.ObjectId().toHexString(),
        email: 'other@example.com',
        role: Role.REGISTERED_USER,
        jti: 'jti-2',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('throws BadRequestException on invalid ID and NotFoundException when missing', async () => {
    await expect(
      service.deletePost('bad-id', {
        userId: new Types.ObjectId().toHexString(),
        email: 'a@b.com',
        role: Role.REGISTERED_USER,
        jti: 'jti',
      }),
    ).rejects.toThrow(BadRequestException);

    mockBlogPostModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });
    await expect(
      service.deletePost(new Types.ObjectId().toHexString(), {
        userId: new Types.ObjectId().toHexString(),
        email: 'a@b.com',
        role: Role.REGISTERED_USER,
        jti: 'jti',
      }),
    ).rejects.toThrow(NotFoundException);
  });
});
