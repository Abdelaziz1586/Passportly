import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UploadsService } from '../uploads/uploads.service';
import { BlogService } from './blog.service';
import { BlogPost } from './schemas/blog-post.schema';
import { Comment } from './schemas/comment.schema';
import { Like } from './schemas/like.schema';
import { User } from '../users/schemas/user.schema';
import { Itinerary } from '../itineraries/schemas/itinerary.schema';
import { Tag } from './schemas/tag.schema';

describe('BlogService (SCRUM-124 BLG-07 update comment)', () => {
  let service: BlogService;

  const mockCommentModel = {
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BlogService,
        { provide: getModelToken(BlogPost.name), useValue: {} },
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
        { provide: getModelToken(User.name), useValue: {} },
        { provide: getModelToken(Itinerary.name), useValue: {} },
        { provide: getModelToken(Tag.name), useValue: {} },
      ],
    }).compile();

    service = module.get<BlogService>(BlogService);
  });

  it('updates comment content when requester is the comment author', async () => {
    const commentId = new Types.ObjectId();
    const postId = new Types.ObjectId();
    const authorId = new Types.ObjectId();

    mockCommentModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: commentId,
        post: postId,
        author: authorId,
        content: 'Old text',
        isHidden: false,
      }),
    });

    mockCommentModel.findByIdAndUpdate.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: commentId,
        post: postId,
        author: authorId,
        content: 'New text',
        isHidden: false,
      }),
    });

    const result = await service.updateComment(
      commentId.toHexString(),
      authorId.toHexString(),
      { content: 'New text' },
    );

    expect(result).toEqual({
      id: commentId.toHexString(),
      post: postId.toHexString(),
      author: authorId.toHexString(),
      content: 'New text',
      isHidden: false,
    });
  });

  it('throws ForbiddenException when another user tries to edit the comment', async () => {
    const commentId = new Types.ObjectId();
    mockCommentModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: commentId,
        author: new Types.ObjectId(),
        isHidden: false,
      }),
    });

    await expect(
      service.updateComment(
        commentId.toHexString(),
        new Types.ObjectId().toHexString(),
        { content: 'Hijack' },
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when comment is hidden by moderation', async () => {
    const commentId = new Types.ObjectId();
    const authorId = new Types.ObjectId();
    mockCommentModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: commentId,
        author: authorId,
        isHidden: true,
      }),
    });

    await expect(
      service.updateComment(commentId.toHexString(), authorId.toHexString(), {
        content: 'Edited',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('throws BadRequestException on invalid ID and NotFoundException when missing', async () => {
    await expect(
      service.updateComment('bad-id', new Types.ObjectId().toHexString(), {
        content: 'Test',
      }),
    ).rejects.toThrow(BadRequestException);

    mockCommentModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });
    await expect(
      service.updateComment(
        new Types.ObjectId().toHexString(),
        new Types.ObjectId().toHexString(),
        { content: 'Test' },
      ),
    ).rejects.toThrow(NotFoundException);
  });
});
