const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

export type User = { id: string; email: string };

export type RecipeSummary = {
  id: string;
  title: string;
  prepTimeMin: number | null;
  cookTimeMin: number | null;
  servings: number | null;
  photoUrl: string | null;
  tags: string[];
  source: string | null;
  favorite: boolean;
  createdAt: string;
};

export type RecipeIngredient = { name: string; quantity: string | null; section: string | null };

export type RecipeDetail = RecipeSummary & {
  steps: string[];
  ingredients: RecipeIngredient[];
  updatedAt: string;
};

export type RecipeInput = {
  title: string;
  prepTimeMin?: number;
  cookTimeMin?: number;
  servings?: number;
  source?: string;
  steps: string[];
  ingredients: RecipeIngredient[];
  tags: string[];
  photo?: { uri: string; name: string; type: string };
  removePhoto?: boolean;
};

export type StructuredRecipeDraft = {
  title: string;
  ingredients: RecipeIngredient[];
  steps: string[];
  prepTimeMin: number | null;
  cookTimeMin: number | null;
  servings: number | null;
  tags: string[];
};

export function resolveUrl(path: string) {
  return `${API_URL}${path}`;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, options: RequestInit & { token?: string } = {}): Promise<T> {
  const { token, headers, ...rest } = options;
  const url = resolveUrl(path);
  const method = options.method ?? 'GET';

  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      headers: {
        ...(headers ?? {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch (err) {
    // Almost always a connectivity issue (wrong EXPO_PUBLIC_API_URL, phone
    // not on the same network as the API, firewall) rather than a bug —
    // logged here because the calling screen only shows a generic message.
    console.log(`[api] ${method} ${url} failed before a response: ${(err as Error).message}`);
    throw err;
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const message = typeof body.error === 'string' ? body.error : JSON.stringify(body.error ?? body);
    console.log(`[api] ${method} ${url} -> ${res.status}: ${message}`);
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export async function checkHealth() {
  return request<{ status: string }>('/health');
}

export async function register(email: string, password: string) {
  return request<{ token: string; user: User }>('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

export async function login(email: string, password: string) {
  return request<{ token: string; user: User }>('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

export async function getMe(token: string) {
  return request<User>('/auth/me', { token });
}

export async function listRecipes(token: string) {
  return request<RecipeSummary[]>('/recipes', { token });
}

export type Tag = { id: string; name: string };

export async function listTags(token: string) {
  return request<Tag[]>('/tags', { token });
}

export async function createTag(token: string, name: string) {
  return request<Tag>('/tags', {
    method: 'POST',
    token,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

export async function updateTag(token: string, id: string, name: string) {
  return request<Tag>(`/tags/${id}`, {
    method: 'PUT',
    token,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

export async function deleteTag(token: string, id: string) {
  return request<void>(`/tags/${id}`, { method: 'DELETE', token });
}

export async function getRecipe(token: string, id: string) {
  return request<RecipeDetail>(`/recipes/${id}`, { token });
}

function buildRecipeFormData(input: RecipeInput) {
  const form = new FormData();
  form.append('title', input.title);
  if (input.prepTimeMin !== undefined) form.append('prepTimeMin', String(input.prepTimeMin));
  if (input.cookTimeMin !== undefined) form.append('cookTimeMin', String(input.cookTimeMin));
  if (input.servings !== undefined) form.append('servings', String(input.servings));
  if (input.source !== undefined) form.append('source', input.source);
  form.append('steps', JSON.stringify(input.steps));
  form.append('ingredients', JSON.stringify(input.ingredients));
  form.append('tags', JSON.stringify(input.tags));
  if (input.photo) {
    // @ts-expect-error React Native FormData accepts { uri, name, type } file parts
    form.append('photo', { uri: input.photo.uri, name: input.photo.name, type: input.photo.type });
  }
  if (input.removePhoto) form.append('removePhoto', 'true');
  return form;
}

export async function createRecipe(token: string, input: RecipeInput) {
  return request<RecipeDetail>('/recipes', {
    method: 'POST',
    token,
    body: buildRecipeFormData(input),
  });
}

export async function updateRecipe(token: string, id: string, input: RecipeInput) {
  return request<RecipeDetail>(`/recipes/${id}`, {
    method: 'PUT',
    token,
    body: buildRecipeFormData(input),
  });
}

export async function deleteRecipe(token: string, id: string) {
  return request<void>(`/recipes/${id}`, { method: 'DELETE', token });
}

export async function setFavorite(token: string, id: string, favorite: boolean) {
  return request<{ favorite: boolean }>(`/recipes/${id}/favorite`, {
    method: 'PATCH',
    token,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ favorite }),
  });
}

// PUT /recipes/:id replaces the whole recipe — this rebuilds its full input
// from a fetched detail, for callers that only change one thing (tags, photo).
export function recipeInputFrom(detail: RecipeDetail): RecipeInput {
  return {
    title: detail.title,
    prepTimeMin: detail.prepTimeMin ?? undefined,
    cookTimeMin: detail.cookTimeMin ?? undefined,
    servings: detail.servings ?? undefined,
    source: detail.source ?? undefined,
    steps: detail.steps,
    ingredients: detail.ingredients,
    tags: detail.tags,
  };
}

export type ScrapedPhotoCandidate = { photoBase64: string; photoMimeType: string; label: string };

// Result of POST /imports/instagram — the post scraped AND structured by
// Claude in a single server call (2026-09-29; used to be /imports/scrape +
// a second /imports/structure call sending the photo back).
export type InstagramImport = {
  scraped: boolean;
  // The structured recipe. Null when scraping failed, or when it worked but
  // Claude didn't — caption/photo are then still set, for a manual retry.
  draft: StructuredRecipeDraft | null;
  // Why scraped is false — each gets its own message in ImportScreen:
  // 'unavailable' = Instagram served the page without this post's data
  // (restricted to logged-in users, or deleted — indistinguishable from the
  // API side); 'bad-url' = not an Instagram post link; 'failed' = Instagram
  // didn't answer properly (worth retrying).
  reason?: 'unavailable' | 'bad-url' | 'failed' | null;
  caption: string | null;
  // Always set when scraped is true (single photo, Reel cover, or a
  // carousel's first image).
  photoBase64: string | null;
  photoMimeType: string | null;
  // Every image of a carousel (photoBase64 is the first), picked from in
  // RecipeEditScreen. Empty for a single image.
  photoCandidates: ScrapedPhotoCandidate[];
};

// `signal` lets the waiting screen's "Annuler" drop the call (the server
// still finishes its Claude request — only the answer is ignored).
export async function importInstagram(token: string, url: string, signal?: AbortSignal) {
  return request<InstagramImport>('/imports/instagram', {
    method: 'POST',
    signal,
    token,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
}

// Photo import (Phase 3): 1-5 photos of one recipe (cookbook pages, in
// order), structured by Claude in one call. The photos only feed the AI —
// they aren't kept as the recipe's photo.
export async function importPhotos(
  token: string,
  photos: { photoBase64: string; photoMimeType: string }[],
  signal?: AbortSignal,
) {
  return request<StructuredRecipeDraft>('/imports/photos', {
    method: 'POST',
    signal,
    token,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photos }),
  });
}

export async function structureRecipe(
  token: string,
  input: { caption?: string; photoBase64?: string; photoMimeType?: string },
  signal?: AbortSignal,
) {
  return request<StructuredRecipeDraft>('/imports/structure', {
    method: 'POST',
    signal,
    token,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}
