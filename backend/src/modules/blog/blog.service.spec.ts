import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { PostStatus } from '../../common/enums';
import { BlogService } from './blog.service';
import { BlogPost } from './schemas/blog-post.schema';
import { Comment } from './schemas/comment.schema';
import { Like } from './schemas/like.schema';
import { Tag } from './schemas/tag.schema';

describe('BlogService (SCRUM-126 BLG-06 like post)', () => {
  let service: BlogService;

  const mockBlogPostModel = {
    findOne: jest.fn(),
    findByIdAndUpdate: jest.fn(),
  };
  const mockLikeModel = {
    create: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BlogService,
        { provide: getModelToken(BlogPost.name), useValue: mockBlogPostModel },
        { provide: getModelToken(Comment.name), useValue: {} },
        { provide: getModelToken(Like.name), useValue: mockLikeModel },
        { provide: getModelToken(Tag.name), useValue: {} },
      ],
    }).compile();

    service = module.get<BlogService>(BlogService);
  });

  it('inserts Like and increments BlogPost.likesCount for published non-hidden post', async () => {
    const postId = new Types.ObjectId();
    const userId = new Types.ObjectId();

    mockBlogPostModel.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: postId,
          likesCount: 2,
        }),
      }),
    });
    mockLikeModel.create.mockResolvedValue({ _id: new Types.ObjectId() });
    mockBlogPostModel.findByIdAndUpdate.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: postId,
          likesCount: 3,
        }),
      }),
    });

    const result = await service.likePost(
      postId.toHexString(),
      userId.toHexString(),
    );

    expect(mockBlogPostModel.findOne).toHaveBeenCalledWith({
      _id: postId.toHexString(),
      status: PostStatus.PUBLISHED,
      isHidden: false,
    });
    expect(mockLikeModel.create).toHaveBeenCalledWith({
      post: postId,
      user: userId,
    });
    expect(result).toEqual({
      message: 'Post liked successfully',
      postId: postId.toHexString(),
      liked: true,
      likesCount: 3,
    });
  });

  it('throws ConflictException on duplicate like (Mongo code 11000) without incrementing likesCount', async () => {
    const postId = new Types.ObjectId();
    const userId = new Types.ObjectId();

    mockBlogPostModel.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: postId, likesCount: 2 }),
      }),
    });
    mockLikeModel.create.mockRejectedValue({ code: 11000 });

    await expect(
      service.likePost(postId.toHexString(), userId.toHexString()),
    ).rejects.toThrow(ConflictException);
    expect(mockBlogPostModel.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when post is draft, hidden, or missing', async () => {
    mockBlogPostModel.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
    });

    await expect(
      service.likePost(
        new Types.ObjectId().toHexString(),
        new Types.ObjectId().toHexString(),
      ),
    ).rejects.toThrow(NotFoundException);
    expect(mockLikeModel.create).not.toHaveBeenCalled();
  });

  it('throws BadRequestException for invalid IDs', async () => {
    await expect(
      service.likePost('bad-post', new Types.ObjectId().toHexString()),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.likePost(new Types.ObjectId().toHexString(), 'bad-user'),
    ).rejects.toThrow(BadRequestException);
  });
});
