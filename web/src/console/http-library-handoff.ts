// A one-item, memory-only handoff survives lazy route mounting without putting
// request data in the URL or dispatching an automatic HTTP request.
export const httpRecipeLoadEvent = 'protopeek:load-http-recipe';
let pending: string | null = null;
export function queueHTTPRecipe(id: string) {
  pending = /^[a-zA-Z0-9-]{1,64}$/.test(id) ? id : null;
}
export function consumeHTTPRecipe() {
  const id = pending;
  pending = null;
  return id;
}
