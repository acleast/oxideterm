### Fixed

- Fixed upstream proxy handling for new SSH connections so host-key preflight and the actual connection use the same SOCKS5 or HTTP CONNECT proxy route.
- Fixed manual jump-host chains so the configured upstream proxy is applied to the first hop during expansion, host-key checks, and connection setup.
- Fixed saved-connection test flows so they pass the resolved upstream proxy into both frontend host-key preflight and backend test connections.
- Fixed test connection diagnostics for proxy-only routes so a direct preflight no longer reports a false failure before the proxy route is attempted.

### Notes

- This is a patch release for users who configured SOCKS5 or HTTP CONNECT upstream proxies in 1.6.0.

---

<details><summary>📦 Installation Tips / 安装提示</summary>

#### macOS

Downloaded `.dmg` files are quarantined by Gatekeeper. Run in Terminal:
下载的 `.dmg` 文件会被 Gatekeeper 隔离，请在终端执行：

```bash
xattr -cr ~/Downloads/OxideTerm_*.dmg
# or after install / 或安装后
xattr -cr /Applications/OxideTerm.app
```

#### Windows

If SmartScreen warns, click **More info → Run anyway**.
若 SmartScreen 弹出警告，点击 **更多信息 → 仍要运行**。

#### Linux

```bash
# AppImage
chmod +x OxideTerm_*_linux_*.AppImage && ./OxideTerm_*_linux_*.AppImage
# Debian/Ubuntu
sudo dpkg -i OxideTerm_*_linux_*.deb && sudo apt-get install -f
```

</details>

[Documentation](https://oxideterm.app) · [Report Issues](https://github.com/AnalyseDeCircuit/OxideTerm/issues) · [Changelog](https://github.com/AnalyseDeCircuit/OxideTerm/tree/main/docs/changelog)