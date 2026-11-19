import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { ItineraryVisibility, PostStatus } from '../../common/enums';
import { Itinerary } from '../itineraries/schemas/itinerary.schema';
import { BlogService } from './blog.service';
import { BlogPost } from './schemas/blog-post.schema';
import { Comment } from './schemas/comment.schema';
import { Like } from './schemas/like.schema';
import { Tag } from './schemas/tag.schema';

describe('BlogService (SCRUM-132 BLG-13 attach itinerary)', () => {
  let service: BlogService;

  const mockBlogPostModel = {
    findById: jest.fn(),
    findOneAndUpdate: jest.fn(),
  };
  const mockItineraryModel = {
    findById: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BlogService,
        { provide: getModelToken(BlogPost.name), useValue: mockBlogPostModel },
        { provide: getModelToken(Comment.name), useValue: {} },
        { provide: getModelToken(Like.name), useValue: {} },
        { provide: getModelToken(Tag.name), useValue: {} },
        {
          provide: getModelToken(Itinerary.name),
          useValue: mockItineraryModel,
        },
      ],
    }).compile();

    service = module.get<BlogService>(BlogService);
  });

  it('attaches a PUBLIC non-hidden itinerary to author blog post', async () => {
    const postId = new Types.ObjectId();
    const authorId = new Types.ObjectId();
    const itineraryId = new Types.ObjectId();

    mockBlogPostModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: postId, author: authorId }),
    });
    mockItineraryModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: itineraryId,
        user: authorId,
        visibility: ItineraryVisibility.PUBLIC,
        isHidden: false,
      }),
    });
    mockBlogPostModel.findOneAndUpdate.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: postId,
        author: authorId,
        title: 'Cairo Guide',
        content: 'Content text.',
        status: PostStatus.PUBLISHED,
        isHidden: false,
        tags: [],
        tagRefs: [],
        images: [],
        likesCount: 0,
        commentsCount: 0,
        attachedItinerary: itineraryId,
      }),
    });

    const result = await service.attachItinerary(
      postId.toHexString(),
      authorId.toHexString(),
      { itineraryId: itineraryId.toHexString() },
    );

    expect(result.attachedItinerary).toBe(itineraryId.toHexString());
  });

  it('detaches itinerary when itineraryId is null', async () => {
    const postId = new Types.ObjectId();
    const authorId = new Types.ObjectId();

    mockBlogPostModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: postId, author: authorId }),
    });
    mockBlogPostModel.findOneAndUpdate.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: postId,
        author: authorId,
        title: 'Cairo Guide',
        content: 'Content text.',
        status: PostStatus.PUBLISHED,
        isHidden: false,
        tags: [],
        tagRefs: [],
        images: [],
        likesCount: 0,
        commentsCount: 0,
        attachedItinerary: null,
      }),
    });

    const result = await service.attachItinerary(
      postId.toHexString(),
      authorId.toHexString(),
      { itineraryId: null },
    );

    expect(mockItineraryModel.findById).not.toHaveBeenCalled();
    expect(result.attachedItinerary).toBeNull();
  });

  it('rejects private or hidden itineraries and non-author post mutations', async () => {
    const postId = new Types.ObjectId();
    const authorId = new Types.ObjectId();
    const otherUserId = new Types.ObjectId();
    const itineraryId = new Types.ObjectId();

    // Non-author on post
    mockBlogPostModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: postId, author: authorId }),
    });
    await expect(
      service.attachItinerary(postId.toHexString(), otherUserId.toHexString(), {
        itineraryId: itineraryId.toHexString(),
      }),
    ).rejects.toThrow(ForbiddenException);

    // Other user's PRIVATE itinerary
    mockItineraryModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: itineraryId,
        user: otherUserId,
        visibility: ItineraryVisibility.PRIVATE,
        isHidden: false,
      }),
    });
    await expect(
      service.attachItinerary(postId.toHexString(), authorId.toHexString(), {
        itineraryId: itineraryId.toHexString(),
      }),
    ).rejects.toThrow(ForbiddenException);

    // Own PRIVATE itinerary (not public)
    mockItineraryModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: itineraryId,
        user: authorId,
        visibility: ItineraryVisibility.PRIVATE,
        isHidden: false,
      }),
    });
    await expect(
      service.attachItinerary(postId.toHexString(), authorId.toHexString(), {
        itineraryId: itineraryId.toHexString(),
      }),
    ).rejects.toThrow(BadRequestException);

    // Hidden itinerary
    mockItineraryModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: itineraryId,
        user: authorId,
        visibility: ItineraryVisibility.PUBLIC,
        isHidden: true,
      }),
    });
    await expect(
      service.attachItinerary(postId.toHexString(), authorId.toHexString(), {
        itineraryId: itineraryId.toHexString(),
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws BadRequestException on invalid postId', async () => {
    await expect(
      service.attachItinerary('bad-id', new Types.ObjectId().toHexString(), {
        itineraryId: null,
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
