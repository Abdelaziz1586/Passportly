import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { PostStatus } from '../../common/enums';
import { BlogService } from './blog.service';
import { BlogPost } from './schemas/blog-post.schema';
import { Comment } from './schemas/comment.schema';
import { Like } from './schemas/like.schema';
import { Tag } from './schemas/tag.schema';

describe('BlogService (SCRUM-118 BLG-02/BLG-09 list and search posts)', () => {
  let service: BlogService;

  const mockLimit = jest.fn();
  const mockSkip = jest.fn();
  const mockSort = jest.fn();
  const mockPopulate = jest.fn();
  const mockLean = jest.fn();

  const mockBlogPostModel = {
    find: jest.fn(),
    countDocuments: jest.fn(),
  };
  const mockTagModel = {
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockLean.mockResolvedValue([]);
    mockLimit.mockReturnValue({ lean: mockLean });
    mockSkip.mockReturnValue({ limit: mockLimit });
    mockSort.mockReturnValue({ skip: mockSkip });
    mockPopulate.mockReturnValue({ sort: mockSort });
    mockBlogPostModel.find.mockReturnValue({ populate: mockPopulate });
    mockBlogPostModel.countDocuments.mockResolvedValue(0);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BlogService,
        { provide: getModelToken(BlogPost.name), useValue: mockBlogPostModel },
        { provide: getModelToken(Comment.name), useValue: {} },
        { provide: getModelToken(Like.name), useValue: {} },
        { provide: getModelToken(Tag.name), useValue: mockTagModel },
      ],
    }).compile();

    service = module.get<BlogService>(BlogService);
  });

  it('lists only PUBLISHED and non-hidden posts with author info and pagination', async () => {
    const authorId = new Types.ObjectId();
    const postId = new Types.ObjectId();
    const publishedAt = new Date('2026-11-18T10:00:00.000Z');

    mockLean.mockResolvedValue([
      {
        _id: postId,
        author: {
          _id: authorId,
          firstName: 'Abdullah',
          lastName: 'Emam',
          avatarUrl: '/uploads/avatar.png',
        },
        title: 'Luxor Guide',
        slug: 'luxor-guide-abc123',
        content: 'Full Luxor guide content.',
        excerpt: 'Full Luxor guide content.',
        status: PostStatus.PUBLISHED,
        isHidden: false,
        tags: ['egypt'],
        tagRefs: [],
        images: [],
        likesCount: 4,
        commentsCount: 2,
        attachedItinerary: null,
        publishedAt,
      },
    ]);
    mockBlogPostModel.countDocuments.mockResolvedValue(1);

    const result = await service.listPosts({ page: 1, limit: 20 });

    expect(mockBlogPostModel.find).toHaveBeenCalledWith({
      status: PostStatus.PUBLISHED,
      isHidden: false,
    });
    expect(mockPopulate).toHaveBeenCalledWith(
      'author',
      'firstName lastName avatarUrl',
    );
    expect(result.total).toBe(1);
    expect(result.totalPages).toBe(1);
    expect(result.data[0].id).toBe(postId.toHexString());
    expect(result.data[0].author).toEqual({
      id: authorId.toHexString(),
      firstName: 'Abdullah',
      lastName: 'Emam',
      avatarUrl: '/uploads/avatar.png',
    });
  });

  it('combines author, tag, and escaped keyword search filters with $and', async () => {
    const authorId = new Types.ObjectId().toHexString();
    const tagId = new Types.ObjectId();

    mockTagModel.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: tagId }),
      }),
    });

    await service.listPosts({
      author: authorId,
      tag: 'Travel Tips',
      search: 'cairo (2026)+',
      page: 2,
      limit: 5,
      sortBy: 'likesCount',
      sortOrder: 'asc',
    });

    const calls = mockBlogPostModel.find.mock.calls as Array<
      [{ $and: unknown[] }]
    >;
    const calledFilter = calls[0][0];
    expect(calledFilter.$and).toHaveLength(4);
    expect(calledFilter.$and[0]).toEqual({
      status: PostStatus.PUBLISHED,
      isHidden: false,
    });
    expect(calledFilter.$and[1]).toEqual({
      author: new Types.ObjectId(authorId),
    });
    expect(mockSort).toHaveBeenCalledWith({ likesCount: 1, _id: 1 });
    expect(mockSkip).toHaveBeenCalledWith(5);
    expect(mockLimit).toHaveBeenCalledWith(5);
  });
});
