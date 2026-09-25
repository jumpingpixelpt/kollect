// A função cache recebida é React.cache: o escopo é uma renderização RSC, nunca
// um TTL compartilhado entre usuários. Fora de RSC, as leituras continuam frescas.
export function createSessionReaders({ cache, readUser, readRole }) {
  const sessionUser = cache(readUser);
  const sessionRole = cache(async () => {
    const user = await sessionUser();
    if (!user) return { user: null, role: null };
    return { user, role: (await readRole(user.id)) ?? "operador" };
  });
  return { sessionUser, sessionRole };
}
