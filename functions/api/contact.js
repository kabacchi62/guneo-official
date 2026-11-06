
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });

export async function onRequestPost({ request, env }) {
  try {
    if (!env.RESEND_API_KEY || !env.TURNSTILE_SECRET_KEY) {
      console.error("Missing server secrets");
      return json({
        ok: false,
        error: "Server configuration error"
      }, 500);
    }

    // 同じサイトからの送信のみ許可
    const origin = request.headers.get("Origin");
    if (!origin) {
      return json({ ok: false, error: "Invalid origin" }, 403);
    }

    let hostname;
    try {
      hostname = new URL(origin).hostname;
    } catch {
      return json({ ok: false, error: "Invalid origin" }, 403);
    }

    if (hostname !== "guneo.net") {
      return json({ ok: false, error: "Invalid origin" }, 403);
    }

    const contentType = request.headers.get("Content-Type") || "";
    if (!contentType.includes("application/json")) {
      return json({ ok: false, error: "Invalid content type" }, 415);
    }

    // 大きすぎるデータを拒否
    const length = Number(request.headers.get("Content-Length"));
    if (Number.isFinite(length) && length > 12000) {
      return json({ ok: false, error: "Request too large" }, 413);
    }

    const rawBody = await request.text();
    if (rawBody.length > 12000) {
      return json({ ok: false, error: "Request too large" }, 413);
    }

    let body;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return json({ ok: false, error: "Invalid JSON" }, 400);
    }

    const {
      name,
      email,
      message,
      website,
      turnstileToken
    } = body;

    // 隠し項目に入力された場合は送信しない
    if (website) {
      return json({ ok: true });
    }

    if (
      typeof name !== "string" ||
      typeof email !== "string" ||
      typeof message !== "string" ||
      typeof turnstileToken !== "string"
    ) {
      return json({ ok: false, error: "Invalid input" }, 400);
    }

    const cleanName = name.trim();
    const cleanEmail = email.trim();
    const cleanMessage = message.trim();

    if (
      !cleanName ||
      cleanName.length > 100 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) ||
      cleanEmail.length > 254 ||
      !cleanMessage ||
      cleanMessage.length > 5000 ||
      !turnstileToken ||
      turnstileToken.length > 2048
    ) {
      return json({ ok: false, error: "Invalid input" }, 400);
    }

    // Cloudflare Turnstileをサーバー側で検証
    const verifyResponse = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          secret: env.TURNSTILE_SECRET_KEY,
          response: turnstileToken,
          remoteip: request.headers.get("CF-Connecting-IP")
        })
      }
    );

    if (!verifyResponse.ok) {
      return json({
        ok: false,
        error: "Verification service unavailable"
      }, 502);
    }

    const verification = await verifyResponse.json();

    if (
      !verification.success ||
      verification.hostname !== "guneo.net"
    ) {
      return json({
        ok: false,
        error: "Verification failed"
      }, 403);
    }

    // 認証成功後にResendでメール送信
    const mailResponse = await fetch(
      "https://api.resend.com/emails",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: "#GUNEO Contact <noreply@guneo.net>",
          to: ["contact@guneo.net"],
          reply_to: cleanEmail,
          subject: `【#GUNEO】お問い合わせ: ${cleanName.replace(/[\r\n]/g, " ")}`,
          text: [
            "公式サイトからお問い合わせが届きました。",
            "",
            `お名前: ${cleanName}`,
            `メールアドレス: ${cleanEmail}`,
            "",
            "お問い合わせ内容:",
            cleanMessage
          ].join("\n")
        })
      }
    );

    if (!mailResponse.ok) {
      console.error("Resend error:", mailResponse.status);
      return json({
        ok: false,
        error: "Mail delivery failed"
      }, 502);
    }

    return json({ ok: true });

  } catch (error) {
    console.error("Contact error:", error);
    return json({
      ok: false,
      error: "Server error"
    }, 500);
  }
}

export async function onRequestGet() {
  return json({
    ok: false,
    error: "Method not allowed"
  }, 405);
}
