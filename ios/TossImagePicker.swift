import PhotosUI
import ImageIO
import React
import UniformTypeIdentifiers

@objc(TossImagePicker)
final class TossImagePicker: NSObject, PHPickerViewControllerDelegate {
  private var resolve: RCTPromiseResolveBlock?
  private var reject: RCTPromiseRejectBlock?
  @objc static func requiresMainQueueSetup() -> Bool { true }

  @objc(pick:rejecter:)
  func pick(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.main.async {
      guard self.resolve == nil, let host = RCTPresentedViewController() else {
        reject("PICKER_UNAVAILABLE", "The image picker is unavailable.", nil); return
      }
      self.resolve = resolve; self.reject = reject
      var config = PHPickerConfiguration()
      config.filter = .images; config.selectionLimit = 1
      let picker = PHPickerViewController(configuration: config)
      picker.delegate = self
      host.present(picker, animated: true)
    }
  }

  func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
    picker.dismiss(animated: true)
    guard let provider = results.first?.itemProvider else { finish(nil); return }
    provider.loadFileRepresentation(forTypeIdentifier: UTType.image.identifier) { url, _ in
      guard let url = url,
        let source = CGImageSourceCreateWithURL(url as CFURL, nil),
        let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
          kCGImageSourceCreateThumbnailFromImageAlways: true,
          kCGImageSourceCreateThumbnailWithTransform: true,
          kCGImageSourceThumbnailMaxPixelSize: 1024
        ] as CFDictionary),
        let bytes = UIImage(cgImage: image).jpegData(compressionQuality: 0.88), bytes.count <= 5 * 1024 * 1024
      else { self.fail(); return }
      let directory = FileManager.default.temporaryDirectory.appendingPathComponent("toss-covers", isDirectory: true)
      do {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        // Only picker-owned temporary files are cleaned. No photo-library mutation.
        for old in (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.creationDateKey])) ?? [] {
          let created = (try? old.resourceValues(forKeys: [.creationDateKey]).creationDate) ?? .distantPast
          if created < Date().addingTimeInterval(-3600) { try? FileManager.default.removeItem(at: old) }
        }
        let output = directory.appendingPathComponent(UUID().uuidString + ".jpg")
        try bytes.write(to: output, options: [.atomic, .completeFileProtection])
        self.finish(["uri": output.absoluteString, "name": "market-cover.jpg", "type": "image/jpeg", "size": bytes.count])
      } catch { self.fail() }
    }
  }
  private func finish(_ value: Any?) {
    DispatchQueue.main.async { let done = self.resolve; self.resolve = nil; self.reject = nil; done?(value) }
  }
  private func fail() {
    DispatchQueue.main.async { let failure = self.reject; self.resolve = nil; self.reject = nil; failure?("PICKER_FAILED", "Choose another image.", nil) }
  }
  @objc(remove:)
  func remove(_ uri: String) {
    guard let url = URL(string: uri), url.isFileURL,
      url.deletingLastPathComponent().standardizedFileURL == FileManager.default.temporaryDirectory.appendingPathComponent("toss-covers", isDirectory: true).standardizedFileURL
    else { return }
    try? FileManager.default.removeItem(at: url)
  }
}
