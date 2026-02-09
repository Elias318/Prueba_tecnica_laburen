export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
    }

    const action = body.action;
    const params = body.params || {};

    // Helpers
    const toInt = (v) => {
      const n = Number(v);
      return Number.isFinite(n) && Number.isInteger(n) ? n : null;
    };

    const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

    switch (action) {
      case "list_products": {
        const query = (params.query || "").toString().toLowerCase();

        let sql = `
          SELECT
            product_code,
            name,
            description,
            price,
            stock,
            size,
            color,
            category,
            price_50_u,
            price_100_u,
            price_200_u
          FROM products
          WHERE available = 1
        `;

        const bindings = [];

        if (query) {
          sql += `
            AND (
              LOWER(name) LIKE ?
              OR LOWER(description) LIKE ?
            )
          `;
          bindings.push(`%${query}%`, `%${query}%`);
        }

        const result = await env.DB.prepare(sql).bind(...bindings).all();

        return Response.json({
          count: result.results.length,
          products: result.results,
        });
      }

      case "get_product_details": {
        const productCodeRaw = params.product_code;
        const productCode = String(productCodeRaw ?? "").trim();

        if (!productCode) {
          return Response.json({ error: "product_code is required" }, { status: 400 });
        }

        // Soporta que llegue 1 vs "001" (padding opcional)
        const productCodePadded = /^\d+$/.test(productCode)
          ? productCode.padStart(3, "0")
          : productCode;

        const product = await env.DB
          .prepare("SELECT * FROM products WHERE product_code = ? OR product_code = ?")
          .bind(productCode, productCodePadded)
          .first();

        if (!product) {
          return Response.json({ error: "Product not found" }, { status: 404 });
        }

        return Response.json({ product });
      }

      case "create_cart": {
        const result = await env.DB.prepare("INSERT INTO carts DEFAULT VALUES").run();
        return Response.json({ cart_id: result.meta.last_row_id });
      }

      case "get_cart": {
        const cartId = toInt(params.cart_id);

        if (cartId === null || cartId <= 0) {
          return Response.json({ error: "cart_id is required (integer > 0)" }, { status: 400 });
        }

        const items = await env.DB
          .prepare(`
            SELECT
              ci.id AS item_id,
              ci.qty,
              p.product_code,
              p.name,
              p.price,
              p.price_50_u,
              p.price_100_u,
              p.price_200_u
            FROM cart_items ci
            JOIN products p ON p.id = ci.product_id
            WHERE ci.cart_id = ?
          `)
          .bind(cartId)
          .all();

        return Response.json({ cart_id: cartId, items: items.results });
      }

      /**
       * update_cart (VALIDADO + FIX product_code number->string + padding)
       */
      case "update_cart": {
        const cartId = toInt(params.cart_id);
        const opRaw = params.op;

        if (cartId === null || cartId <= 0) {
          return Response.json({ error: "cart_id is required (integer > 0)" }, { status: 400 });
        }

        const op = String(opRaw ?? "").trim();
        if (!op) {
          return Response.json({ error: "op is required: add | set_qty | remove" }, { status: 400 });
        }

        const normalizedOp = op;

        // ✅ FIX: aceptar product_code numérico y también "001"
        const productCodeRaw = params.product_code;
        const productCode = String(productCodeRaw ?? "").trim();
        if (!productCode) {
          return Response.json({ error: "product_code is required" }, { status: 400 });
        }
        const productCodePadded = /^\d+$/.test(productCode)
          ? productCode.padStart(3, "0")
          : productCode;

        // qty validations for ops needing qty
        let qtyInt = null;
        if (normalizedOp === "add" || normalizedOp === "set_qty") {
          qtyInt = toInt(params.qty);
          if (qtyInt === null || qtyInt < 0) {
            return Response.json({ error: "qty must be an integer >= 0" }, { status: 400 });
          }
        }

        // Buscar producto + disponibilidad + stock (busca por code normal o padded)
        const product = await env.DB
          .prepare("SELECT id, available, stock FROM products WHERE product_code = ? OR product_code = ?")
          .bind(productCode, productCodePadded)
          .first();

        if (!product) {
          return Response.json(
            { error: "Product not found", product_code_received: productCode },
            { status: 404 }
          );
        }

        if (Number(product.available) !== 1) {
          return Response.json({ error: "Product not available" }, { status: 409 });
        }

        // Buscar item actual en carrito
        const cartItem = await env.DB
          .prepare(`
            SELECT id, qty
            FROM cart_items
            WHERE cart_id = ? AND product_id = ?
          `)
          .bind(cartId, product.id)
          .first();

        const stockNum =
          product.stock === null || product.stock === undefined ? null : Number(product.stock);
        const hasStock = Number.isFinite(stockNum);

        // --- ADD ---
        if (normalizedOp === "add") {
          if (qtyInt === 0) {
            return Response.json(
              { error: "qty must be > 0 for op=add (use set_qty or remove)" },
              { status: 400 }
            );
          }

          const currentQty = cartItem ? Number(cartItem.qty) : 0;
          const finalQty = currentQty + qtyInt;

          if (hasStock && finalQty > stockNum) {
            return Response.json(
              { error: "Insufficient stock", stock: stockNum, requested: finalQty },
              { status: 409 }
            );
          }

          if (cartItem) {
            await env.DB
              .prepare(`UPDATE cart_items SET qty = ? WHERE id = ? AND cart_id = ?`)
              .bind(finalQty, cartItem.id, cartId)
              .run();

            return Response.json({
              status: "updated",
              cart_id: cartId,
              product_code: productCodePadded,
              qty: finalQty,
            });
          }

          await env.DB
            .prepare(`INSERT INTO cart_items (cart_id, product_id, qty) VALUES (?, ?, ?)`)
            .bind(cartId, product.id, qtyInt)
            .run();

          return Response.json({
            status: "added",
            cart_id: cartId,
            product_code: productCodePadded,
            qty: qtyInt,
          });
        }

        // --- SET_QTY ---
        if (normalizedOp === "set_qty") {
          if (!cartItem) {
            if (qtyInt > 0) {
              if (hasStock && qtyInt > stockNum) {
                return Response.json(
                  { error: "Insufficient stock", stock: stockNum, requested: qtyInt },
                  { status: 409 }
                );
              }

              await env.DB
                .prepare(`INSERT INTO cart_items (cart_id, product_id, qty) VALUES (?, ?, ?)`)
                .bind(cartId, product.id, qtyInt)
                .run();

              return Response.json({
                status: "added",
                cart_id: cartId,
                product_code: productCodePadded,
                qty: qtyInt,
              });
            }

            return Response.json({
              status: "removed",
              cart_id: cartId,
              product_code: productCodePadded,
            });
          }

          if (qtyInt === 0) {
            await env.DB
              .prepare(`DELETE FROM cart_items WHERE id = ? AND cart_id = ?`)
              .bind(cartItem.id, cartId)
              .run();

            return Response.json({
              status: "removed",
              cart_id: cartId,
              product_code: productCodePadded,
            });
          }

          if (hasStock && qtyInt > stockNum) {
            return Response.json(
              { error: "Insufficient stock", stock: stockNum, requested: qtyInt },
              { status: 409 }
            );
          }

          await env.DB
            .prepare(`UPDATE cart_items SET qty = ? WHERE id = ? AND cart_id = ?`)
            .bind(qtyInt, cartItem.id, cartId)
            .run();

          return Response.json({
            status: "updated",
            cart_id: cartId,
            product_code: productCodePadded,
            qty: qtyInt,
          });
        }

        // --- REMOVE ---
        if (normalizedOp === "remove") {
          if (!cartItem) {
            return Response.json({
              status: "removed",
              cart_id: cartId,
              product_code: productCodePadded,
            });
          }

          await env.DB
            .prepare(`DELETE FROM cart_items WHERE id = ? AND cart_id = ?`)
            .bind(cartItem.id, cartId)
            .run();

          return Response.json({
            status: "removed",
            cart_id: cartId,
            product_code: productCodePadded,
          });
        }

        return Response.json(
          { error: "Invalid op. Use add | set_qty | remove" },
          { status: 400 }
        );
      }

      /**
       * Actions viejas (compatibilidad)
       */
      case "add_to_cart": {
        const cartId = toInt(params.cart_id);
        const productCodeRaw = params.product_code;
        const qtyInt = toInt(params.qty);

        const productCode = String(productCodeRaw ?? "").trim();
        if (cartId === null || cartId <= 0 || !productCode || qtyInt === null || qtyInt <= 0) {
          return Response.json(
            { error: "cart_id (int>0), product_code and qty (int>0) are required" },
            { status: 400 }
          );
        }

        const productCodePadded = /^\d+$/.test(productCode)
          ? productCode.padStart(3, "0")
          : productCode;

        const product = await env.DB
          .prepare("SELECT id, available, stock FROM products WHERE product_code = ? OR product_code = ?")
          .bind(productCode, productCodePadded)
          .first();

        if (!product) return Response.json({ error: "Product not found" }, { status: 404 });
        if (Number(product.available) !== 1)
          return Response.json({ error: "Product not available" }, { status: 409 });

        const stockNum =
          product.stock === null || product.stock === undefined ? null : Number(product.stock);
        const hasStock = Number.isFinite(stockNum);
        if (hasStock && qtyInt > stockNum) {
          return Response.json(
            { error: "Insufficient stock", stock: stockNum, requested: qtyInt },
            { status: 409 }
          );
        }

        await env.DB
          .prepare(`INSERT INTO cart_items (cart_id, product_id, qty) VALUES (?, ?, ?)`)
          .bind(cartId, product.id, qtyInt)
          .run();

        return Response.json({
          status: "added",
          cart_id: cartId,
          product_code: productCodePadded,
          qty: qtyInt,
        });
      }

      case "update_cart_item": {
        const itemId = toInt(params.item_id);
        const qtyInt = toInt(params.qty);

        if (itemId === null || itemId <= 0 || qtyInt === null || qtyInt < 0) {
          return Response.json(
            { error: "item_id (int>0) and qty (int>=0) are required" },
            { status: 400 }
          );
        }

        if (qtyInt === 0) {
          await env.DB.prepare(`DELETE FROM cart_items WHERE id = ?`).bind(itemId).run();
          return Response.json({ status: "removed", item_id: itemId });
        }

        await env.DB.prepare(`UPDATE cart_items SET qty = ? WHERE id = ?`).bind(qtyInt, itemId).run();
        return Response.json({ status: "updated", item_id: itemId, qty: qtyInt });
      }

      case "remove_cart_item": {
        const itemId = toInt(params.item_id);

        if (itemId === null || itemId <= 0) {
          return Response.json({ error: "item_id (int>0) is required" }, { status: 400 });
        }

        await env.DB.prepare("DELETE FROM cart_items WHERE id = ?").bind(itemId).run();
        return Response.json({ status: "removed", item_id: itemId });
      }

      case "handoff_to_human":
        return Response.json({
          status: "handoff_requested",
          note: "Conversation should be routed to human agent in Chatwoot",
        });

      default:
        return Response.json({ error: "Unknown action" }, { status: 400 });
    }
  },
};
