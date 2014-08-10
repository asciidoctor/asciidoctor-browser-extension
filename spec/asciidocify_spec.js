describe("asciidocify", function () {

  describe("loadContent", function () {
    beforeEach(function () {
      chrome = {
        storage:{
          local:{
            get:function () {
            }
          }
        },
        extension:{
          getURL:function (path) {
          }
        },
        runtime:{
          getManifest:function () {
            return {web_accessible_resources:[]};
          }
        }
      };
      asciidoctor.chrome.convert = function () {
      };
    });

    it("should call convert method if extension is enabled", function () {
      // Given
      var data = {};
      data.responseText = "= Hello world";
      spyOn(chrome.storage.local, "get").and.callFake(function (name, callback) {
        var values = [];
        values[ENABLE_RENDER_KEY] = true;
        callback(values);
      });
      spyOn(asciidoctor.chrome, "convert");
      // When
      asciidoctor.chrome.loadContent(data);
      // Then
      expect(asciidoctor.chrome.convert).toHaveBeenCalledWith("= Hello world");
    });

    it("should not call convert method if extension is disabled", function () {
      // Given
      var data = {};
      data.responseText = "= Hello world";
      spyOn(chrome.storage.local, "get").and.callFake(function (name, callback) {
        var values = [];
        values[ENABLE_RENDER_KEY] = false;
        callback(values);
      });
      spyOn(asciidoctor.chrome, "convert");
      // When
      asciidoctor.chrome.loadContent(data);
      // Then
      expect(asciidoctor.chrome.convert).not.toHaveBeenCalledWith("= Hello world");
    });
  });

});