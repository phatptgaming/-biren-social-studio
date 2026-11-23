export type PostStatus = 'published' | 'failed';

export interface PageInfo {
  id: string;
  name: string;
  accessToken?: string;
  picture?: string;
}

export interface HistoryPost {
  id: string;
  caption: string;
  pageId: string | null;
  pageName: string | null;
  imageUrl: string | null;
  createdAt: string;
  publishedAt: string | null;
  status: PostStatus;
  facebookPostId: string | null;
  errorMessage: string | null;
}
