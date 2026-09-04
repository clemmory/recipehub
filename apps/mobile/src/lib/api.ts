const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

export type User = { id: string; email: string };

export type RecipeSummary = {
  id: string;
  title: string;
  prepTimeMin: number | null;
  cookTimeMin: number | null;
  servings: number | null;
  photoUrl: string | null;
  createdAt: string;
};

export type RecipeIngredient = { name: string; quantity: string | null };

export type RecipeDetail = RecipeSummary & {
  steps: string[];
  ingredients: RecipeIngredient[];
  tags: string[];
  updatedAt: string;
};

export type RecipeInput = {
  title: string;
  prepTimeMin?: number;
  cookTimeMin?: number;
  servings?: number;
  steps: string[];
  ingredients: RecipeIngredient[];
  tags: string[];
  photo?: { uri: string; name: string; type: string };
  removePhoto?: boolean;
};

export function resolveUrl(path: string) {
  return `${API_URL}${path}`;
}

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, options: RequestInit & { token?: string } = {}): Promise<T> {
  const { token, headers, ...rest } = options;
  const res = await fetch(resolveUrl(path), {
    ...rest,
    headers: {
      ...(headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const message = typeof body.error === 'string' ? body.error : JSON.stringify(body.error ?? body);
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

export async function getRecipe(token: string, id: string) {
  return request<RecipeDetail>(`/recipes/${id}`, { token });
}

function buildRecipeFormData(input: RecipeInput) {
  const form = new FormData();
  form.append('title', input.title);
  if (input.prepTimeMin !== undefined) form.append('prepTimeMin', String(input.prepTimeMin));
  if (input.cookTimeMin !== undefined) form.append('cookTimeMin', String(input.cookTimeMin));
  if (input.servings !== undefined) form.append('servings', String(input.servings));
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
