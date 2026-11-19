import { BadRequestException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { PostStatus } from '../../common/enums';
import { BlogService } from './blog.service';
import { BlogPost } from './schemas/blog-post.schema';
import { Comment } from './schemas/comment.schema';
import { Like } from './schemas/like.schema';
import { Tag } from './schemas/tag.schema';

describe('BlogService (SCRUM-119 BLG-03 list my posts)', () => {
  let service: BlogService;

  const mockLean = jest.fn();
  const mockLimit = jest.fn();
  const mockSkip = jest.fn();
  const mockSort = jest.fn();
  const mockBlogPostModel = {
    find: jest.fn(),
    countDocuments: jest.fn(),
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
      ],
    }).compile();

    service = module.get<BlogService>(BlogService);
  });

  it('returns both drafts and published posts for current user when status is omitted', async () => {
    const userId = new Types.ObjectId().toHexString();
    const draftId = new Types.ObjectId();
    const publishedId = new Types.ObjectId();

    mockLean.mockResolvedValue([
      {
        _id: draftId,
        author: new Types.ObjectId(userId),
        title: 'Draft Trip',
        content: 'Draft content here.',
        status: PostStatus.DRAFT,
        isHidden: false,
        tags: [],
        tagRefs: [],
        images: [],
        likesCount: 0,
        commentsCount: 0,
        attachedItinerary: null,
      },
      {
        _id: publishedId,
        author: new Types.ObjectId(userId),
        title: 'Published Trip',
        content: 'Published content here.',
        status: PostStatus.PUBLISHED,
        isHidden: false,
        tags: ['egypt'],
        tagRefs: [],
        images: [],
        likesCount: 3,
        commentsCount: 1,
        attachedItinerary: null,
      },
    ]);
    mockBlogPostModel.countDocuments.mockResolvedValue(2);

    const result = await service.listMyPosts(userId, { page: 1, limit: 20 });

    expect(mockBlogPostModel.find).toHaveBeenCalledWith({
      author: new Types.ObjectId(userId),
    });
    expect(result.total).toBe(2);
    expect(result.data.map((p) => p.status)).toEqual([
      PostStatus.DRAFT,
      PostStatus.PUBLISHED,
    ]);
  });

  it('filters by optional status when provided', async () => {
    const userId = new Types.ObjectId().toHexString();

    await service.listMyPosts(userId, {
      status: PostStatus.DRAFT,
      page: 2,
      limit: 5,
      sortBy: 'createdAt',
      sortOrder: 'asc',
    });

    expect(mockBlogPostModel.find).toHaveBeenCalledWith({
      author: new Types.ObjectId(userId),
      status: PostStatus.DRAFT,
    });
    expect(mockSort).toHaveBeenCalledWith({ createdAt: 1, _id: 1 });
    expect(mockSkip).toHaveBeenCalledWith(5);
    expect(mockLimit).toHaveBeenCalledWith(5);
  });

  it('throws BadRequestException for invalid user ID', async () => {
    await expect(service.listMyPosts('invalid-id', {})).rejects.toThrow(
      BadRequestException,
    );
  });
});
