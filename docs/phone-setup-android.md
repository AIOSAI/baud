# Setting up BAUD on an Android phone

Your phone reaches BAUD over your own Tailscale network, so the phone and the machine need to be on the same tailnet. This takes about five minutes. You need the installer's last block from the machine, so keep that terminal open.

## Steps

1. On the phone, open the Play Store, search for **Tailscale**, and install it.
2. Open Tailscale and sign in with the **same account** you used on the machine (`tailscale up` printed that sign-in link).
3. Allow the VPN request Android shows. Tailscale uses Android's VPN slot to reach your tailnet.
4. Check that Tailscale says **Connected** and that your machine is in its list of devices.
5. **Hold your phone up.** The installer's last block on the machine is a QR code under **Pair your phone**. If the install ended without one, its **Server** line says *not answering*: the install could not start the server for you (a machine without systemd, such as a Docker container, is the usual case). Start it and mint the code yourself, in a new terminal or after `exec bash` in the same one so it sees the install's settings:
   ```
   drone @api host-api serve --detach
   drone @api host-api pair phone --scope operate
   ```
   Open the phone's camera and point it at the code. The code works once and expires after five minutes, so do this when you are ready to scan. To pair later, or to pair another phone, run `drone @api host-api pair phone --scope operate` on the machine for a fresh code.
6. Tap the link the camera offers. If your camera offers none, use Google Lens or the QR scanner in Android's quick settings.
7. BAUD opens in Chrome, says **pairing this phone…**, and signs itself in. Nothing is typed or pasted.
8. The wheel appears with your agents on it. You are in.
9. In Chrome's ⋮ menu, tap **Add to Home screen**, so BAUD opens from an icon like an app.

## When the code has expired

BAUD's sign-in page says **This pairing code has expired or was already used**. On the machine, run `drone @api host-api pair phone --scope operate` and scan the new code (step 5).

If you cannot scan at all, the sign-in page still takes a pasted token. On the machine, `drone @api host-api issue-token phone --scope operate` writes one to a receipt file it names. Get it onto the phone without a chat or an email, paste it into **access token**, and tap **connect**.

## When the page does not load

- **Tailscale is off on one side.** The phone's Tailscale must say Connected. On the machine, `tailscale status` must list the phone. Turn on whichever side is off, then reload.
- **The machine's API is not running.** The face is served by AIPass's host API on the machine. If the machine restarted, start the API again the way the installer's last lines describe, then reload.
- **The address is wrong.** It must be the machine's tailnet address (`100.x.y.z`) with the port, starting with `http://`, not `https://`. The line under the QR shows it, as does `tailscale ip -4` on the machine.
- **The sign-in page says the token is refused.** The token may have been revoked or mistyped. Pair again (step 5), or paste a new one.
- **The phone was lost.** On the machine, `drone @api host-api list-tokens` shows each token, and `drone @api host-api revoke-token <id>` cuts the lost phone off at once.
