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
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UploadsService } from '../uploads/uploads.service';
import { BlogService } from './blog.service';
import { BlogPost } from './schemas/blog-post.schema';
import { Comment } from './schemas/comment.schema';
import { Like } from './schemas/like.schema';
import { Tag } from './schemas/tag.schema';

describe('BlogService (SCRUM-125 BLG-07 delete comment)', () => {
  let service: BlogService;

  const mockBlogPostModel = {
    updateOne: jest.fn(),
  };
  const mockCommentModel = {
    findById: jest.fn(),
    findByIdAndDelete: jest.fn(),
  };
  const mockAuditLogsService = {
    log: jest.fn(),
  };
  const mockNotificationsService = {
    createNotification: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockBlogPostModel.updateOne.mockResolvedValue({ modifiedCount: 1 });
    mockAuditLogsService.log.mockResolvedValue({});
    mockNotificationsService.createNotification.mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BlogService,
        { provide: getModelToken(BlogPost.name), useValue: mockBlogPostModel },
        { provide: getModelToken(Comment.name), useValue: mockCommentModel },
        { provide: getModelToken(Like.name), useValue: {} },
        {
          provide: UploadsService,
          useValue: { deleteImage: jest.fn(), saveImage: jest.fn() },
        },
        { provide: AuditLogsService, useValue: { log: jest.fn() } },
        {
          provide: NotificationsService,
          useValue: { createNotification: jest.fn() },
        },
        { provide: getModelToken(Tag.name), useValue: {} },
        { provide: AuditLogsService, useValue: mockAuditLogsService },
        { provide: NotificationsService, useValue: mockNotificationsService },
      ],
    }).compile();

    service = module.get<BlogService>(BlogService);
  });

  it('allows author to delete comment and decrements BlogPost.commentsCount', async () => {
    const commentId = new Types.ObjectId();
    const postId = new Types.ObjectId();
    const authorId = new Types.ObjectId();

    const commentDoc = {
      _id: commentId,
      post: postId,
      author: authorId,
      content: 'Comment text',
    };
    mockCommentModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue(commentDoc),
    });
    mockCommentModel.findByIdAndDelete.mockReturnValue({
      lean: jest.fn().mockResolvedValue(commentDoc),
    });

    const result = await service.deleteComment(commentId.toHexString(), {
      userId: authorId.toHexString(),
      email: 'abdullah@example.com',
      role: Role.REGISTERED_USER,
      jti: 'jti-1',
    });

    expect(result).toEqual({
      message: 'Comment deleted successfully',
      id: commentId.toHexString(),
      postId: postId.toHexString(),
    });
    expect(mockBlogPostModel.updateOne).toHaveBeenCalledWith(
      { _id: postId, commentsCount: { $gt: 0 } },
      { $inc: { commentsCount: -1 } },
    );
    expect(mockAuditLogsService.log).not.toHaveBeenCalled();
  });

  it('allows ADMIN to delete another user comment with audit log and notification', async () => {
    const commentId = new Types.ObjectId();
    const postId = new Types.ObjectId();
    const authorId = new Types.ObjectId();
    const adminId = new Types.ObjectId();

    const commentDoc = {
      _id: commentId,
      post: postId,
      author: authorId,
      content: 'Abusive comment',
    };
    mockCommentModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue(commentDoc),
    });
    mockCommentModel.findByIdAndDelete.mockReturnValue({
      lean: jest.fn().mockResolvedValue(commentDoc),
    });

    await service.deleteComment(
      commentId.toHexString(),
      {
        userId: adminId.toHexString(),
        email: 'admin@example.com',
        role: Role.ADMIN,
        jti: 'jti-admin',
      },
      '127.0.0.1',
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
        targetType: 'Comment',
      }),
    );
  });

  it('throws ForbiddenException for non-author non-admin', async () => {
    const commentId = new Types.ObjectId();
    mockCommentModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: commentId,
        post: new Types.ObjectId(),
        author: new Types.ObjectId(),
      }),
    });

    await expect(
      service.deleteComment(commentId.toHexString(), {
        userId: new Types.ObjectId().toHexString(),
        email: 'other@example.com',
        role: Role.REGISTERED_USER,
        jti: 'jti-2',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('throws BadRequestException on invalid ID and NotFoundException when missing', async () => {
    await expect(
      service.deleteComment('bad-id', {
        userId: new Types.ObjectId().toHexString(),
        email: 'a@b.com',
        role: Role.REGISTERED_USER,
        jti: 'jti',
      }),
    ).rejects.toThrow(BadRequestException);

    mockCommentModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });
    await expect(
      service.deleteComment(new Types.ObjectId().toHexString(), {
        userId: new Types.ObjectId().toHexString(),
        email: 'a@b.com',
        role: Role.REGISTERED_USER,
        jti: 'jti',
      }),
    ).rejects.toThrow(NotFoundException);
  });
});
