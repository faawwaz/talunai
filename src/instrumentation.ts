export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { config } = await import("../packages/api/config");
    const { validateStartup } = await import("../packages/chain/service");
    config();
    await validateStartup();
  }
}
