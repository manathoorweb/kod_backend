import { Hono } from 'hono';
import { 
  listBlogPosts, 
  getBlogPostBySlug, 
  getFeaturedBlogPost, 
  getPopularBlogPosts, 
  incrementPostViews,
  listCategories,
  getBlogPostComments,
  addCommentToBlogPost
} from '../controllers/blog.controller.js';
import { wrap } from '../utils/hono-adapter.js';

const app = new Hono();

app.get('/', wrap(listBlogPosts));
app.get('/featured', wrap(getFeaturedBlogPost));
app.get('/popular', wrap(getPopularBlogPosts));
app.get('/post/:slug', wrap(getBlogPostBySlug));
app.get('/categories', wrap(listCategories));
app.get('/:id/comments', wrap(getBlogPostComments));
app.post('/:id/comments', wrap(addCommentToBlogPost));
app.post('/:id/view', wrap(incrementPostViews));

export { app as blogRoutes };
