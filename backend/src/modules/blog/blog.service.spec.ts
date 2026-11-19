import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { AccountStatus, PostStatus } from '../../common/enums';
import { User } from '../users/schemas/user.schema';
import { BlogService } from './blog.service';
import { BlogPost } from './schemas/blog-post.schema';
import { Comment } from './schemas/comment.schema';
import { Like } from './schemas/like.schema';
import { Tag } from './schemas/tag.schema';

describe('BlogService (SCRUM-131 BLG-12 author profile & posts)', () => {
  let service: BlogService;

  const mockLean = jest.fn();
  const mockLimit = jest.fn();
  const mockSkip = jest.fn();
  const mockSort = jest.fn();
  const mockBlogPostModel = {
    find: jest.fn(),
    countDocuments: jest.fn(),
  };
  const mockUserModel = {
    findById: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockLean.mockResolvedValue([]);
    mockLimit.mockReturnValue({ lean: mockLean });
    mockSkip.mockReturnValue({ limit: mockLimit });
    mockSort.mockReturnValue({ skip: mockSkip });
    mockBlogPostModel.find.mockReturnValue({ sort: mockSort });
    mockBlogPostModel.countDocuments.mockResolvedValue(0);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BlogService,
        { provide: getModelToken(BlogPost.name), useValue: mockBlogPostModel },
        { provide: getModelToken(Comment.name), useValue: {} },
        { provide: getModelToken(Like.name), useValue: {} },
        { provide: getModelToken(Tag.name), useValue: {} },
        { provide: getModelToken(User.name), useValue: mockUserModel },
      ],
    }).compile();

    service = module.get<BlogService>(BlogService);
  });

  it('returns safe public author profile without sensitive fields and paginated published posts', async () => {
    const authorId = new Types.ObjectId();
    const postId = new Types.ObjectId();
    const createdAt = new Date('2026-11-01T10:00:00.000Z');

    const mockUserSelectLean = jest.fn().mockResolvedValue({
      _id: authorId,
      firstName: 'Abdullah',
      lastName: 'Emam',
      avatarUrl: '/uploads/avatars/me.png',
      bio: 'Backpacker',
      status: AccountStatus.ACTIVE,
      createdAt,
    });
    const mockUserSelect = jest
      .fn()
      .mockReturnValue({ lean: mockUserSelectLean });
    mockUserModel.findById.mockReturnValue({ select: mockUserSelect });

    mockLean.mockResolvedValue([
      {
        _id: postId,
        author: authorId,
        title: 'Jordan Petra Guide',
        content: 'Two days in Petra.',
        status: PostStatus.PUBLISHED,
        isHidden: false,
        tags: ['jordan'],
        tagRefs: [],
        images: [],
        likesCount: 5,
        commentsCount: 1,
        attachedItinerary: null,
      },
    ]);
    mockBlogPostModel.countDocuments.mockResolvedValue(1);

    const result = await service.getAuthorPage(authorId.toHexString(), {
      page: 1,
      limit: 20,
    });

    expect(mockUserSelect).toHaveBeenCalledWith(
      'firstName lastName avatarUrl bio status createdAt',
    );
    expect(mockBlogPostModel.find).toHaveBeenCalledWith({
      author: authorId,
      status: PostStatus.PUBLISHED,
      isHidden: false,
    });
    expect(result.author).toEqual({
      id: authorId.toHexString(),
      firstName: 'Abdullah',
      lastName: 'Emam',
      fullName: 'Abdullah Emam',
      avatarUrl: '/uploads/avatars/me.png',
      bio: 'Backpacker',
      createdAt,
    });
    expect(result.posts.total).toBe(1);
    expect(result.posts.data[0].id).toBe(postId.toHexString());
  });

  it('throws NotFoundException when author is missing or suspended/deactivated', async () => {
    mockUserModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
    });

    await expect(
      service.getAuthorPage(new Types.ObjectId().toHexString(), {}),
    ).rejects.toThrow(NotFoundException);

    mockUserModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: new Types.ObjectId(),
          firstName: 'Test',
          lastName: 'User',
          status: AccountStatus.SUSPENDED,
        }),
      }),
    });

    await expect(
      service.getAuthorPage(new Types.ObjectId().toHexString(), {}),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws BadRequestException on invalid author ID', async () => {
    await expect(service.getAuthorPage('bad-id', {})).rejects.toThrow(
      BadRequestException,
    );
  });
});
