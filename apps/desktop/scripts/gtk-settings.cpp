#include <gtk/gtk.h>
#include <pango/pango.h>

#include <algorithm>
#include <cstring>
#include <iostream>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

#include "gtk-settings-json.hpp"
#include "gtk-settings-rendering.hpp"
#include "gtk-settings-title-buttons.hpp"

using namespace hive::gtk_settings;

static std::vector<std::string> parse_side(const std::string &side) {
  std::vector<std::string> result;
  std::stringstream input(side);
  std::string item;
  while (std::getline(input, item, ',')) {
    const auto first = item.find_first_not_of(" \t\r\n");
    if (first == std::string::npos) continue;
    const auto last = item.find_last_not_of(" \t\r\n");
    result.push_back(item.substr(first, last - first + 1));
  }
  return result;
}

int main(int argc, char **argv) {
  gboolean has_theme_override = FALSE;
  gboolean requested_dark = FALSE;
  for (int index = 1; index < argc;) {
    if (std::strcmp(argv[index], "--hive-theme=dark") == 0 || std::strcmp(argv[index], "--hive-theme=light") == 0) {
      has_theme_override = TRUE;
      requested_dark = std::strcmp(argv[index], "--hive-theme=dark") == 0;
      for (int next = index; next < argc; ++next) argv[next] = argv[next + 1];
      --argc;
      continue;
    }
    ++index;
  }

  if (!gtk_init_check(&argc, &argv)) {
    emit_fallback();
    return 0;
  }

  GtkSettings *settings = gtk_settings_get_default();
  if (!settings) {
    emit_fallback();
    return 0;
  }

  gchar *theme = nullptr;
  gchar *font = nullptr;
  gchar *icons = nullptr;
  gchar *decoration_layout = nullptr;
  gboolean dark = FALSE;
  g_object_get(settings,
               "gtk-theme-name", &theme,
               "gtk-font-name", &font,
               "gtk-icon-theme-name", &icons,
               "gtk-application-prefer-dark-theme", &dark,
               "gtk-decoration-layout", &decoration_layout,
               nullptr);
  if (has_theme_override) {
    g_object_set(settings, "gtk-application-prefer-dark-theme", requested_dark, nullptr);
  }
  const bool render_dark = has_theme_override ? requested_dark : dark;
  g_object_set(settings, "gtk-enable-animations", FALSE, nullptr);

  const std::string layout = decoration_layout && *decoration_layout
      ? decoration_layout
      : "menu:minimize,maximize,close";
  const auto colon = layout.find(':');
  const std::string left_text = colon == std::string::npos ? "" : layout.substr(0, colon);
  const std::string right_text = colon == std::string::npos ? layout : layout.substr(colon + 1);
  const auto left = parse_side(left_text);
  const auto right = parse_side(right_text);

  PangoFontDescription *font_description = font ? pango_font_description_from_string(font) : nullptr;
  const char *font_family = font_description ? pango_font_description_get_family(font_description) : "";

  GtkWidget *window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
  gtk_window_set_title(GTK_WINDOW(window), "Hive");
  gtk_window_set_default_size(GTK_WINDOW(window), 720, 160);
  gtk_window_set_resizable(GTK_WINDOW(window), TRUE);
  gtk_window_set_deletable(GTK_WINDOW(window), TRUE);
  gtk_window_set_accept_focus(GTK_WINDOW(window), FALSE);
  gtk_window_set_skip_taskbar_hint(GTK_WINDOW(window), TRUE);
  gtk_window_set_skip_pager_hint(GTK_WINDOW(window), TRUE);
  gtk_widget_set_opacity(window, 0.0);

  GtkWidget *header = gtk_header_bar_new();
  gtk_header_bar_set_decoration_layout(GTK_HEADER_BAR(header), layout.c_str());
  gtk_header_bar_set_show_close_button(GTK_HEADER_BAR(header), TRUE);
  gtk_window_set_titlebar(GTK_WINDOW(window), header);
  gtk_window_move(GTK_WINDOW(window), -10000, -10000);
  gtk_widget_show_all(window);
  while (gtk_events_pending()) gtk_main_iteration_do(FALSE);
  gdk_display_flush(gdk_display_get_default());
  while (gtk_events_pending()) gtk_main_iteration_do(FALSE);

  TitleButtons buttons;
  collect_title_buttons(header, &buttons);
  GtkWidget *maximize_image = buttons.maximize ? find_first_image(buttons.maximize) : nullptr;

  const std::vector<std::pair<const char *, GtkWidget *>> title_widgets = {
      {"minimize", buttons.minimize},
      {"maximize", buttons.maximize},
      {"close", buttons.close},
  };
  std::vector<ButtonRaster> current_rasters(title_widgets.size());
  capture_button_variants(window, title_widgets, &current_rasters, false);
  capture_button_variants(window, title_widgets, &current_rasters, true);

  const fs::path title_button_assets = find_theme_title_button_assets(theme);
  const int scale = std::max(1, gtk_widget_get_scale_factor(window));
  for (size_t i = 0; i < title_widgets.size(); ++i) {
    apply_theme_title_button_assets(title_button_assets,
                                    title_widgets[i].first,
                                    &current_rasters[i],
                                    render_dark,
                                    scale);
  }

  ButtonRaster restore_raster;
  if (maximize_image) {
    GtkIconSize image_size = GTK_ICON_SIZE_MENU;
    if (GTK_IS_IMAGE(maximize_image)) {
      const gchar *icon_name = nullptr;
      gtk_image_get_icon_name(GTK_IMAGE(maximize_image), &icon_name, &image_size);
      if (!icon_name) image_size = GTK_ICON_SIZE_MENU;
    }
    gtk_image_set_from_icon_name(GTK_IMAGE(maximize_image), "window-restore-symbolic", image_size);
    std::vector<std::pair<const char *, GtkWidget *>> restore_widgets = {{"restore", buttons.maximize}};
    std::vector<ButtonRaster> restore_rasters(1);
    capture_button_variants(window, restore_widgets, &restore_rasters, false);
    capture_button_variants(window, restore_widgets, &restore_rasters, true);
    restore_raster = restore_rasters.front();
    apply_theme_title_button_assets(title_button_assets, "restore", &restore_raster, render_dark, scale);
  }

  GtkStyleContext *header_context = gtk_widget_get_style_context(header);
  GtkWidget *button_widget = buttons.minimize ? buttons.minimize
      : (buttons.maximize ? buttons.maximize : (buttons.close ? buttons.close : header));
  GtkStyleContext *button_context = gtk_widget_get_style_context(button_widget);
  GtkAllocation header_allocation{};
  GtkAllocation button_allocation{};
  gtk_widget_get_allocation(header, &header_allocation);
  gtk_widget_get_allocation(button_widget, &button_allocation);
  const auto header_background = css_color(context_color(header_context,
                                                         GTK_STATE_FLAG_NORMAL,
                                                         true,
                                                         header_allocation.width,
                                                         header_allocation.height));
  const auto header_foreground = css_color(context_color(header_context, GTK_STATE_FLAG_NORMAL, false));
  const GtkStateFlags states[] = {
      GTK_STATE_FLAG_NORMAL,
      GTK_STATE_FLAG_PRELIGHT,
      static_cast<GtkStateFlags>(GTK_STATE_FLAG_PRELIGHT | GTK_STATE_FLAG_ACTIVE),
      GTK_STATE_FLAG_INSENSITIVE,
  };
  const char *state_names[] = {"normal", "hover", "active", "disabled"};
  std::string button_json = "{";
  for (size_t i = 0; i < 4; ++i) {
    if (i) button_json += ',';
    button_json += json_quote(state_names[i]) + ":{\"foreground\":" +
        json_quote(css_color(context_color(button_context, states[i], false)).c_str()) +
        ",\"background\":" +
        json_quote(css_color(context_color(button_context,
                                           states[i],
                                           true,
                                           button_allocation.width,
                                           button_allocation.height)).c_str()) + "}";
  }
  button_json += '}';

  GtkIconTheme *icon_theme = gtk_icon_theme_get_default();
  const auto menu_icon = icon_data_uri(icon_theme, button_context, "open-menu-symbolic");

  gint min_height = 0;
  gint natural_height = 0;
  gtk_widget_get_preferred_height(header, &min_height, &natural_height);
  const int header_height = std::max(1, natural_height);

  std::cout << "{\"gtk\":{\"version\":3,\"theme\":" << json_quote(theme)
            << ",\"iconTheme\":" << json_quote(icons)
            << ",\"font\":" << json_quote(font)
            << ",\"fontFamily\":" << json_quote(font_family)
            << ",\"dark\":" << (dark ? "true" : "false")
            << "},\"window\":{\"decorationLayout\":{\"layout\":" << json_quote(layout.c_str())
            << ",\"left\":" << json_array(left) << ",\"right\":" << json_array(right)
            << "}},\"icons\":{\"menu\":" << json_quote(menu_icon.c_str()) << "}"
            << ",\"titleButtons\":{\"spacing\":" << buttons.spacing
            << ",\"minimize\":" << button_raster_json(current_rasters[0])
            << ",\"maximize\":" << button_raster_json(current_rasters[1])
            << ",\"restore\":" << button_raster_json(restore_raster)
            << ",\"close\":" << button_raster_json(current_rasters[2]) << '}'
            << ",\"button\":" << button_json
            << ",\"headerbar\":{\"background\":" << json_quote(header_background.c_str())
            << ",\"foreground\":" << json_quote(header_foreground.c_str())
            << ",\"height\":" << header_height << "}}" << std::endl;

  gtk_widget_destroy(window);
  if (font_description) pango_font_description_free(font_description);
  g_free(theme);
  g_free(font);
  g_free(icons);
  g_free(decoration_layout);
  return 0;
}
