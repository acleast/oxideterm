use super::*;

impl WorkspaceApp {
    pub(in crate::workspace) fn render_saved_connections_sidebar_content(
        &self,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let theme = self.tokens.ui;
        let connections = self.connection_store.connection_infos();

        div()
            .flex_1()
            .min_h(px(0.0))
            .w_full()
            .pt(px(PRIMARY_SIDEBAR_CONTENT_TOP_INSET))
            .overflow_y_scrollbar()
            .when(connections.is_empty(), |content| {
                content.child(
                    div()
                        .px_2()
                        .py_4()
                        .text_center()
                        .text_size(px(self.tokens.metrics.ui_text_xs))
                        .text_color(rgb(theme.text_muted))
                        .child(self.i18n.t("sidebar.panels.no_saved_connections")),
                )
            })
            .children(
                connections
                    .into_iter()
                    .map(|connection| self.render_saved_connection_sidebar_row(connection, cx)),
            )
            .into_any_element()
    }

    fn render_saved_connection_sidebar_row(
        &self,
        connection: oxideterm_connections::ConnectionInfo,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let theme = self.tokens.ui;
        let id = connection.id.clone();
        let detail = format!(
            "{}@{}:{}",
            connection.username, connection.host, connection.port
        );
        div()
            .w_full()
            .flex()
            .items_center()
            .gap(px(8.0))
            .rounded(px(self.tokens.radii.md))
            .px(px(8.0))
            .py(px(6.0))
            .cursor_pointer()
            .hover(|row| row.bg(rgb(self.tokens.ui.bg_hover)))
            .child(Self::render_lucide_icon(
                LucideIcon::Server,
                12.0,
                rgb(theme.text_muted),
            ))
            .child(
                div()
                    .min_w(px(0.0))
                    .flex_1()
                    .flex()
                    .flex_col()
                    .gap(px(2.0))
                    .child(
                        div()
                            .truncate()
                            .text_size(px(self.tokens.metrics.ui_text_xs))
                            .text_color(rgb(theme.text))
                            .child(connection.name),
                    )
                    .child(
                        div()
                            .truncate()
                            .text_size(px(10.0))
                            .text_color(rgb(theme.text_muted))
                            .child(detail),
                    ),
            )
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(move |this, _event, window, cx| {
                    this.open_saved_connection(&id, window, cx);
                    cx.stop_propagation();
                }),
            )
            .into_any_element()
    }
}
