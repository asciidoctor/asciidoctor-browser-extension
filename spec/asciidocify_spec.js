describe("asciidocify", function () {

  describe("loadContent", function () {
    beforeEach(function () {
      chrome = {
        storage:{
          local:{
            get:function () {
            }
          }
        }
      };
      Processor = {
        convert:function () {
        }
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
      spyOn(Processor, "convert");
      // When
      Main.loadContent(data);
      // Then
      expect(Processor.convert).toHaveBeenCalledWith("= Hello world");
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
      spyOn(Processor, "convert");
      // When
      Main.loadContent(data);
      // Then
      expect(Processor.convert).not.toHaveBeenCalledWith("= Hello world");
    });
  });

});