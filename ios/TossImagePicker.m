#import <React/RCTBridgeModule.h>
@interface RCT_EXTERN_MODULE(TossImagePicker, NSObject)
RCT_EXTERN_METHOD(pick:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(remove:(NSString *)uri)
@end
