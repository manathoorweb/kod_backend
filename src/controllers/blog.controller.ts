import { FastifyRequest, FastifyReply } from 'fastify';
import { pool } from '../config/db';

interface ListBlogQuery {
  categorySlug?: string;
  limit?: string;
  search?: string;
}

interface SlugParams {
  slug: string;
}

interface IdParams {
  id: string;
}

interface AddCommentBody {
  authorName: string;
  authorEmail: string;
  content: string;
}

/**
 * Get all blog posts, optionally filtered by category, search, and status
 */
export async function listBlogPosts(request: FastifyRequest, reply: FastifyReply) {
  const { categorySlug, limit, search, status } = request.query as ListBlogQuery & { status?: string };
  const limitVal = limit ? parseInt(limit, 10) : null;

  try {
    let queryText = `
      SELECT p.*, 
             json_build_object('id', c.id, 'name', c.name, 'slug', c.slug) as category,
             json_build_object('id', a.id, 'name', a.name, 'avatar_url', a.avatar, 'user_id', a.user_id) as author
      FROM blog_posts p
      LEFT JOIN blog_categories c ON p.category_id = c.id
      LEFT JOIN blog_authors a ON p.author_id = a.id
      WHERE 1=1
    `;
    const queryParams: any[] = [];

    // If status is not 'all', default to 'published'
    if (status !== 'all') {
      queryText += ` AND p.status = 'published'`;
    }

    if (categorySlug) {
      queryParams.push(categorySlug);
      queryText += ` AND c.slug = $${queryParams.length}`;
    }

    if (search) {
      queryParams.push(`%${search}%`);
      queryText += ` AND (p.title ILIKE $${queryParams.length} OR p.excerpt ILIKE $${queryParams.length} OR p.content ILIKE $${queryParams.length})`;
    }

    queryText += ' ORDER BY p.published_at DESC, p.created_at DESC';

    if (limitVal && !isNaN(limitVal)) {
      queryParams.push(limitVal);
      queryText += ` LIMIT $${queryParams.length}`;
    }

    const postsRes = await pool.query(queryText, queryParams);
    return reply.send(postsRes.rows);
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Failed to retrieve blog posts' });
  }
}

/**
 * Get a single blog post by its slug
 */
export async function getBlogPostBySlug(request: FastifyRequest, reply: FastifyReply) {
  const { slug } = request.params as SlugParams;

  try {
    const queryText = `
      SELECT p.*, 
             json_build_object('id', c.id, 'name', c.name, 'slug', c.slug) as category,
             json_build_object('id', a.id, 'name', a.name, 'avatar_url', a.avatar, 'bio', a.bio, 'user_id', a.user_id) as author
      FROM blog_posts p
      LEFT JOIN blog_categories c ON p.category_id = c.id
      LEFT JOIN blog_authors a ON p.author_id = a.id
      WHERE p.slug = $1 AND p.status = 'published'
    `;
    const postRes = await pool.query(queryText, [slug]);
    
    if (postRes.rows.length === 0) {
      return reply.status(404).send({ error: 'Blog post not found' });
    }
    
    return reply.send(postRes.rows[0]);
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Failed to retrieve blog post details' });
  }
}

/**
 * Get the single featured blog post
 */
export async function getFeaturedBlogPost(request: FastifyRequest, reply: FastifyReply) {
  try {
    const queryText = `
      SELECT p.*, 
             json_build_object('id', c.id, 'name', c.name, 'slug', c.slug) as category,
             json_build_object('id', a.id, 'name', a.name, 'avatar_url', a.avatar, 'user_id', a.user_id) as author
      FROM blog_posts p
      LEFT JOIN blog_categories c ON p.category_id = c.id
      LEFT JOIN blog_authors a ON p.author_id = a.id
      WHERE p.featured = true AND p.status = 'published'
      ORDER BY p.published_at DESC, p.created_at DESC
      LIMIT 1
    `;
    const postRes = await pool.query(queryText);
    
    if (postRes.rows.length === 0) {
      return reply.status(404).send({ error: 'Featured blog post not found' });
    }
    
    return reply.send(postRes.rows[0]);
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Failed to retrieve featured blog post' });
  }
}

/**
 * Get popular blog posts
 */
export async function getPopularBlogPosts(request: FastifyRequest, reply: FastifyReply) {
  const { limit } = request.query as ListBlogQuery;
  const limitVal = limit ? parseInt(limit, 10) : 5;

  try {
    const queryText = `
      SELECT p.*, 
             json_build_object('id', c.id, 'name', c.name, 'slug', c.slug) as category
      FROM blog_posts p
      LEFT JOIN blog_categories c ON p.category_id = c.id
      WHERE p.status = 'published'
      ORDER BY p.views_count DESC
      LIMIT $1
    `;
    const postsRes = await pool.query(queryText, [limitVal]);
    return reply.send(postsRes.rows);
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Failed to retrieve popular blog posts' });
  }
}

/**
 * Increment views count of a post
 */
export async function incrementPostViews(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as IdParams;

  try {
    await pool.query(
      'UPDATE blog_posts SET views_count = COALESCE(views_count, 0) + 1 WHERE id = $1',
      [id]
    );
    return reply.send({ success: true });
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Failed to increment post views' });
  }
}

/**
 * Get all blog categories
 */
export async function listCategories(request: FastifyRequest, reply: FastifyReply) {
  try {
    const categoriesRes = await pool.query('SELECT * FROM blog_categories ORDER BY name ASC');
    return reply.send(categoriesRes.rows);
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Failed to retrieve blog categories' });
  }
}

/**
 * Get comments for a blog post
 */
export async function getBlogPostComments(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as IdParams;

  try {
    const commentsRes = await pool.query(
      'SELECT * FROM blog_editorial_comments WHERE post_id = $1 ORDER BY created_at DESC',
      [id]
    );
    return reply.send(commentsRes.rows);
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Failed to retrieve blog comments' });
  }
}

/**
 * Add a comment to a blog post
 */
export async function addCommentToBlogPost(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as IdParams;
  const { authorName, authorEmail, content } = request.body as AddCommentBody;

  try {
    const commentRes = await pool.query(
      `INSERT INTO blog_editorial_comments (post_id, author_name, author_email, comment_text)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [id, authorName, authorEmail, content]
    );
    return reply.status(201).send(commentRes.rows[0]);
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Failed to submit comment' });
  }
}

export async function listAuthors(request: FastifyRequest, reply: FastifyReply) {
  try {
    const authorsRes = await pool.query('SELECT * FROM blog_authors ORDER BY name ASC');
    return reply.send(authorsRes.rows);
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Failed to retrieve blog authors' });
  }
}

interface CreateBlogBody {
  title: string;
  slug: string;
  excerpt?: string;
  content: string;
  category_id: string;
  author_id: string;
  image?: string;
  image_alt?: string;
  featured?: boolean;
  status: string;
  read_time?: string;
  published_at?: string;
}

export async function createBlogPost(request: FastifyRequest, reply: FastifyReply) {
  try {
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const body = request.body as CreateBlogBody;
    const {
      title,
      slug,
      excerpt,
      content,
      category_id,
      author_id,
      image,
      image_alt,
      featured,
      status,
      read_time,
      published_at,
    } = body;

    if (!title || !slug || !content) {
      return reply.status(400).send({ error: 'Title, slug, and content are required' });
    }

    const result = await pool.query(
      `INSERT INTO blog_posts (
        title, slug, excerpt, content, category_id, author_id, 
        image, image_alt, featured, status, read_time, published_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
      RETURNING *`,
      [
        title,
        slug,
        excerpt || '',
        content,
        category_id || null,
        author_id || null,
        image || '',
        image_alt || '',
        featured || false,
        status || 'draft',
        read_time || '5 min read',
        published_at ? new Date(published_at) : null,
      ]
    );

    return reply.status(201).send({ success: true, data: result.rows[0] });
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: err.message || 'Failed to create blog post' });
  }
}

export async function updateBlogPost(request: FastifyRequest, reply: FastifyReply) {
  try {
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const { id } = request.params as IdParams;
    const body = request.body as Partial<CreateBlogBody>;
    
    const checkRes = await pool.query('SELECT * FROM blog_posts WHERE id = $1', [id]);
    if (checkRes.rows.length === 0) {
      return reply.status(404).send({ error: 'Blog post not found' });
    }

    const currentPost = checkRes.rows[0];

    const fieldsToUpdate: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    const fields = [
      'title', 'slug', 'excerpt', 'content', 'category_id', 'author_id',
      'image', 'image_alt', 'featured', 'status', 'read_time', 'published_at'
    ];

    for (const field of fields) {
      if (body[field as keyof Partial<CreateBlogBody>] !== undefined) {
        fieldsToUpdate.push(`${field} = $${paramIndex}`);
        let val = body[field as keyof Partial<CreateBlogBody>];
        if (field === 'published_at' && val) {
          val = new Date(val as string) as any;
        }
        values.push(val);
        paramIndex++;
      }
    }

    if (fieldsToUpdate.length === 0) {
      return reply.send({ success: true, data: currentPost });
    }

    values.push(id);
    const updateQuery = `
      UPDATE blog_posts 
      SET ${fieldsToUpdate.join(', ')}, updated_at = NOW() 
      WHERE id = $${paramIndex} 
      RETURNING *
    `;

    const result = await pool.query(updateQuery, values);
    return reply.send({ success: true, data: result.rows[0] });
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: err.message || 'Failed to update blog post' });
  }
}

export async function deleteBlogPost(request: FastifyRequest, reply: FastifyReply) {
  try {
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const { id } = request.params as IdParams;

    const checkRes = await pool.query('SELECT * FROM blog_posts WHERE id = $1', [id]);
    if (checkRes.rows.length === 0) {
      return reply.status(404).send({ error: 'Blog post not found' });
    }

    await pool.query('DELETE FROM blog_posts WHERE id = $1', [id]);
    return reply.send({ success: true });
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Failed to delete blog post' });
  }
}

